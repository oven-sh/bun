import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "compiled.ts": `console.log([3, 1, 2].map(x => x * 2).join());\n`,
  "text.ts": `
    import { runInNewContext } from "node:vm";
    console.log(runInNewContext("[3, 1, 2].map(x => x * 2).reduceRight((s, x) => s + x, 0)"));
  `,
};

async function whatIsMade(dir: string, entry: string) {
  const executable = join(dir, entry.replace(".ts", isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], dir, bunEnv);
  expect(built.exitCode).toBe(0);
  const path = executable + ".counts";
  const { stdout, exitCode } = await run([executable], dir, { ...bunEnv, BUN_JSC_aotCountsPath: path });
  const made = readFileSync(path, "utf8")
    .split("\n")
    .filter(line => line.includes("\tmade:"))
    .map(line => line.split("\tmade:").reverse().join(" "));
  return { stdout, exitCode, made };
}

test("the tables that only the parser and the bytecode generator read are made when a built-in function is first run from its text", async () => {
  using dir = tempDir("aot-nothing-for-the-parser", files);
  expect(await whatIsMade(String(dir), "compiled.ts")).toEqual({
    stdout: "6,2,4\n",
    exitCode: 0,
    made: ["BytecodeIntrinsicRegistry 0", "StackListingsAfterGivenUpCaptures 0"],
  });
  expect(await whatIsMade(String(dir), "text.ts")).toEqual({
    stdout: "12\n",
    exitCode: 0,
    made: ["BytecodeIntrinsicRegistry 1", "StackListingsAfterGivenUpCaptures 0"],
  });
}, 240_000);
