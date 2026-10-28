// `flatMap` allocates room for two elements per call of its callback, so a callback that returns pairs never asks the runtime to grow the array.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const source = `
  declare const process: { argv: string[] };
  const lists: number[][] = [
    [1, 2, 3, 4],
    [8, 7, 6, 5],
  ];
  function turn(i: number): number {
    return lists[i & 1]!.flatMap(x => [x, x + 1]).length;
  }
  const rounds = Number(process.argv[2]);
  let total = 0;
  for (let i = 0; i < rounds; i++) total += turn(i);
  console.log(total === rounds * 8);
`;

test("flatMap with a callback that returns pairs does not grow its array at run time", async () => {
  using directory = tempDir("aot-flat-map-of-pairs", { "main.ts": source });
  const cwd = String(directory);
  const executable = join(cwd, "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], cwd, bunEnv);
  expect(built.exitCode).toBe(0);
  const counted = async (rounds: number) => {
    const path = join(cwd, "counts" + rounds);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds)], cwd, env)).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
    const counts: Record<string, number> = {};
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined) counts[name] = Number(count);
    }
    return counts;
  };
  const few = await counted(500);
  const many = await counted(2500);
  expect(Object.keys(few).length).toBeGreaterThan(0);
  expect((many.operationAOTGrowNewArray ?? 0) - (few.operationAOTGrowNewArray ?? 0)).toBeLessThan(200);
}, 240_000);
