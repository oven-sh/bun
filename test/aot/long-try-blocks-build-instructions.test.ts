import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { withReport } from "./harness/flags";
import { expectLinearInstructionCount } from "./long-functions-instructions";
import { writeLocalsStoredInTry, writeStringsStoredInTry } from "./long-functions-programs";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;

async function countLimitHits(localCount: number, limit: string) {
  using dir = tempDir("aot-long-try-blocks", { "main.js": writeLocalsStoredInTry(localCount).source });
  const cwd = String(dir);
  const cmd = [bunExe(), "build", "--compile", "--aot", ...withReport("./report.json", "summary"), "./main.js"];
  await using built = Bun.spawn({ cmd: [...cmd, "--outfile", "./main"], cwd, env: bunEnv, stderr: "pipe" });
  expect({ errors: await built.stderr.text(), exitCode: await built.exited }).toMatchObject({ exitCode: 0 });
  const { limits } = (await Bun.file(`${cwd}/report.json`).json()) as { limits: { name: string; hits: number }[] };
  return limits.find(it => it.name === limit)?.hits;
}

test.skipIf(isSlowBuild || isWindows)(
  "the instructions of a build are linear in the number of locals a try block stores to",
  async () => {
    await expectLinearInstructionCount(4_000, writeLocalsStoredInTry, 4);
  },
  240_000,
);

test.skipIf(isSlowBuild || isWindows)(
  "the instructions of a build are linear in the number of strings a try block stores to locals",
  async () => {
    await expectLinearInstructionCount(4_000, writeStringsStoredInTry, 4);
  },
  240_000,
);

test.skipIf(isSlowBuild)(
  "the report counts a function whose try block stores to too many locals",
  async () => {
    expect(await Promise.all([100, 200].map(count => countLimitHits(count, "MaxHandlerArguments")))).toEqual([0, 1]);
  },
  120_000,
);
