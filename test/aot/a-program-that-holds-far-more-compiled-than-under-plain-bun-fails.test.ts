// run-parallel.ts holds the most that a compiled run held against the most that plain Bun's run of the same program held.
// Room that compiled code lays in store ahead of a deed shows in nothing that a program prints.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// On Windows nothing tells the driver what a process held, and under a sanitizer it does not ask.
test.skipIf(isWindows || isASAN)("a program that holds far more compiled than under plain Bun fails", async () => {
  const fills = (bytes: string) => `const room = new Uint8Array(${bytes}).fill(1);\nconsole.log(room[0]);\n`;
  using dir = tempDir("a-program-that-holds-far-more-compiled", {
    "tsconfig.json": "{}",
    // Only an executable fills this room: it stands for compiled code that lays room in store.
    "holds-more.js": fills(`Bun.main.startsWith("/$bunfs/") ? 600 * 2 ** 20 : 1`),
    "holds-more-and-has-no-interpreter.js":
      "// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1\n" +
      fills(`Bun.main.startsWith("/$bunfs/") ? 600 * 2 ** 20 : 1`),
    "holds-the-same.js": fills("600 * 2 ** 20"),
  });
  const root = String(dir);
  const files = ["holds-more.js", "holds-more-and-has-no-interpreter.js", "holds-the-same.js"].map(name =>
    join(root, name),
  );
  const driver = join(import.meta.dir, "run-parallel.ts");
  const { stdout, exitCode } = await run(
    [bunExe(), driver, `--root=${root}`, "--jobs=2", "--no-erased", ...files],
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
  const message = "it held N MB at most, and plain Bun N MB";
  expect(verdicts).toEqual([
    { file: "holds-more-and-has-no-interpreter.js", state: "fail", stage: "memory", message },
    { file: "holds-more.js", state: "fail", stage: "memory", message },
    { file: "holds-the-same.js", state: "pass", stage: undefined, message: undefined },
  ]);
  expect(exitCode).toBe(1);
});
