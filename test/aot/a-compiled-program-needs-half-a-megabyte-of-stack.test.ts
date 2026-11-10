// A compiled program keeps 256 KB of the stack of every thread for the code of the run time, three times that with a sanitizer.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// In KB. Linux sizes the stack of the main thread from `ulimit -s`.
const enough = isASAN ? 1280 : 512;
const enoughForPlainBunAlone = isASAN ? 768 : 256;
const withStack = (size: number, ...cmd: string[]) => ["sh", "-c", `ulimit -s ${size} && exec "$@"`, "sh", ...cmd];

test.skipIf(!isLinux)(
  "an executable starts with the stack that the page names, and says so where it has less",
  async () => {
    using directory = tempDir("aot-stack", { "hello.js": `console.log("hello");\n` });
    const folder = String(directory);
    const executable = join(folder, "hello");
    const build = await run([bunExe(), "build", "--compile", "--aot", "hello.js", "--outfile", executable], folder);
    expect(build).toMatchObject({ exitCode: 0 });

    expect(await run(withStack(enough, executable), folder)).toMatchObject({ stdout: "hello\n", exitCode: 0 });
    const plain = await run(withStack(enoughForPlainBunAlone, bunExe(), "run", "hello.js"), folder);
    expect(plain).toMatchObject({ stdout: "hello\n", exitCode: 0 });
    const { stdout, stderr, exitCode } = await run(withStack(enoughForPlainBunAlone, executable), folder);
    expect(stderr).toContain("RangeError: Maximum call stack size exceeded");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  },
);

test.skipIf(!isLinux)("so does a compiled test run", async () => {
  using directory = tempDir("aot-stack", {
    "one.test.js": `import { expect, test } from "bun:test";\ntest("one", () => expect(1).toBe(1));\n`,
  });
  const folder = String(directory);
  const { stderr, exitCode } = await run(withStack(enough, bunExe(), "test", "--aot", "./one.test.js"), folder, bunEnv);
  expect(stderr).toContain("\n 1 pass");
  expect(exitCode).toBe(0);
});
