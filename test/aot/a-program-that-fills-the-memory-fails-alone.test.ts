// Runs alone: it fills the memory of the machine.
// run-parallel.ts shares the memory of the machine among all that it runs at once. What holds most when that runs short is ended, and the others go on.
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const isCanary = Bun.spawnSync([bunExe(), "--revision"]).stdout.toString().includes("-canary");

// Elsewhere the driver looks once a second, and on Windows nothing tells it what a process holds.
test.skipIf(!isLinux || !isCanary)(
  "a program that fills the memory fails alone",
  async () => {
    using dir = tempDir("a-program-that-fills-the-memory", {
      "tsconfig.json": "{}",
      "before.js": `console.log("before");\n`,
      // Over 600 MB a second.
      "fills.mjs": `import vm from "node:vm";\nconst kept = [];\nfor (;;) kept.push(vm.createContext({}));\n`,
      "waits.js": `await Bun.sleep(1500);\nconsole.log("waited");\n`,
    });
    const root = String(dir);
    const files = ["before.js", "fills.mjs", "waits.js"].map(name => join(root, name));
    const driver = join(import.meta.dir, "run-parallel.ts");
    const { stdout, exitCode } = await run(
      [bunExe(), driver, `--root=${root}`, "--jobs=3", "--memory=2048", ...files],
      root,
      bunEnv,
    );
    const verdicts = stdout
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(({ state }) => state !== "compiling")
      .map(({ file, state, stage, message }) => ({
        file: file.slice(root.length + 1),
        state,
        stage,
        message: message?.replace(/\d+/g, "N"),
      }))
      .sort((a, b) => a.file.localeCompare(b.file));
    expect(verdicts).toEqual([
      { file: "before.js", state: "pass", stage: undefined, message: undefined },
      {
        file: "fills.mjs",
        state: "fail",
        stage: "run",
        message: "it ended by SIGKILL: it held N MB of the N MB that N processes held together, which may hold N MB",
      },
      { file: "waits.js", state: "pass", stage: undefined, message: undefined },
    ]);
    expect(exitCode).toBe(1);
  },
  60_000,
);
