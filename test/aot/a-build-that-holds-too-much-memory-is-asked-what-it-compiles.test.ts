// run-parallel.ts ends a build that holds too much memory as it ends one that runs over its time: it asks first, and the build says what each of its threads is still compiling.
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Elsewhere the driver looks once a second, and on Windows nothing tells it what a process holds.
test.skipIf(!isLinux)(
  "a build that holds too much memory is asked what it compiles",
  async () => {
    using dir = tempDir("a-build-that-holds-too-much-memory", {
      "tsconfig.json": "{}",
      "small.js": `console.log("small");\n/* Output:\nsmall\n*/\n`,
    });
    const root = String(dir);
    const driver = join(import.meta.dir, "run-parallel.ts");
    const { stdout, exitCode } = await run(
      [bunExe(), driver, `--root=${root}`, "--jobs=1", "--no-erased", "--memory=8", join(root, "small.js")],
      root,
      bunEnv,
    );
    const [verdict] = stdout
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(({ state }) => state !== "compiling");
    expect({ ...verdict, message: verdict.message.split("\n")[0].replace(/\d+/g, "N") }).toMatchObject({
      state: "fail",
      stage: "compile",
      message:
        "the build ended with SIGTERM: it held N MB of the N MB that N processes held together, which may hold N MB",
    });
    expect(exitCode).toBe(1);
  },
  60_000,
);
