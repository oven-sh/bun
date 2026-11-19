// `# TODO: <owner>: <what is lost>` in an IR test says that the file fails today. ./testaot.ts counts such a file among those that were run, so here is what the line stands for,
// on files that are made here: the file is run, it fails once it passes, and a stop of the compiler's own verifier fails it whatever it is marked with.
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { expectEveryTestPasses, runTool, skipOrFail, testaot, whyNoTestaot } from "./testaot";

const program = 'module m0 path="/a.ts" displayPath="a.ts"\n';
const mark = "# TODO: somebody: some day\n";
const files = {
  "passes.ir": `# RUN: verify\n# DIAGNOSTIC: NoEntryPoint 1\n\n${program}`,
  "marked-and-fails.ir": `${mark}# RUN: verify\n# DIAGNOSTIC: NoEntryPoint 2\n\n${program}`,
  "marked-and-passes.ir": `${mark}# RUN: verify\n# DIAGNOSTIC: NoEntryPoint 1\n\n${program}`,
  "marked-and-stopped-by-the-verifier.ir": `${mark}# RUN: verify\n\n${program}`,
};

async function judged(...names: (keyof typeof files)[]) {
  using folder = tempDir("what-a-todo-of-an-ir-test-stands-for", files);
  const { lines, exitCode } = await runTool([testaot!, "run", ...names], String(folder));
  return { lines, exitCode };
}

if (whyNoTestaot) skipOrFail(whyNoTestaot);
else {
  test("a file that fails under the line is run, and is counted apart", async () => {
    expect(await judged("passes.ir", "marked-and-fails.ir")).toEqual({
      lines: [
        "TODO marked-and-fails.ir:1: somebody: some day",
        "  still fails: marked-and-fails.ir:3: verify: expected 2 of NoEntryPoint, got 1",
        "1 passed, 0 failed, 1 todo",
      ],
      exitCode: 0,
    });
  });

  test("a file that passes under the line fails", async () => {
    expect(await judged("marked-and-passes.ir")).toEqual({
      lines: ["FAIL marked-and-passes.ir:1: passes: remove the TODO line", "0 passed, 1 failed, 0 todo"],
      exitCode: 1,
    });
  });

  test("the line stands for no stop of the compiler's own verifier", async () => {
    expect(await judged("marked-and-stopped-by-the-verifier.ir")).toEqual({
      lines: [
        "FAIL marked-and-stopped-by-the-verifier.ir:2: verify: unexpected diagnostic NoEntryPoint: the program has no entry point",
        "0 passed, 1 failed, 0 todo",
      ],
      exitCode: 1,
    });
  });

  test("the files of this folder count both, and take no run of which nothing passed", async () => {
    using folder = tempDir("what-a-todo-of-an-ir-test-stands-for", files);
    expect(await expectEveryTestPasses(["run", "passes.ir", "marked-and-fails.ir"], String(folder))).toBe(2);
    await expect(expectEveryTestPasses(["run", "marked-and-fails.ir"], String(folder))).rejects.toThrow();
  });
}
