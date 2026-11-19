// A joined text is made flat in front of the loop that reads its characters: work and memory of the size of the text.
// Where the loop runs no turn nothing reads the text, and it stays as it was joined.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const program = `function joined(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
function upFrom(text: string, from: number): number {
  let sum = 0;
  for (let i = from; i < text.length; i++) sum += text.charCodeAt(i);
  return sum;
}
function downFrom(text: string, from: number): number {
  let sum = 0;
  for (let i = from; i >= 0; i--) sum += text.charCodeAt(i);
  return sum;
}
function counted(text: string, turns: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += text.charCodeAt(turn);
  return sum;
}
function inRows(text: string, rows: number, columns: number): number {
  let sum = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) sum += text.charCodeAt(row + column);
  }
  return sum;
}
function begins(text: string, turns: number): number {
  let hits = 0;
  for (let turn = 0; turn < turns; turn++) hits += text.startsWith("ab") ? 1 : 0;
  return hits;
}
function oneUnit(text: string, turns: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += text.charCodeAt(1) + turn;
  return sum;
}
function besideOneUnit(text: string, turns: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += text.charCodeAt(turn) + text.charCodeAt(1);
  return sum;
}
const turns: number = JSON.parse(process.argv[2]!);
const text = () => joined(JSON.parse('"ab"'), 10);
const first = text();
console.log(
  upFrom(first, first.length - turns),
  downFrom(text(), turns - 1),
  counted(text(), turns),
  counted(text(), turns ? turns : NaN),
  inRows(text(), turns, 2),
  begins(text(), turns),
  oneUnit(text(), turns),
  besideOneUnit(text(), turns),
);
`;

function flattenings(counts: string): number {
  return readFileSync(counts, "utf8")
    .split("\n")
    .map(line => line.split("\t"))
    .filter(([, name]) => name === "operation:operationAOTFlatten")
    .reduce((sum, [count]) => sum + Number(count), 0);
}

describe("compile/aot/a-text-in-front-of-a-loop-that-runs-no-turn", () => {
  test("is made flat only where a turn begins", async () => {
    using dir = tempDir("aot-a-text-in-front-of-a-loop-that-runs-no-turn", { "main.ts": program });
    const cwd = String(dir);
    built(
      await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", join(cwd, "main")], cwd, bunEnv),
    );
    const counts = join(cwd, "counts");
    const idle = await spawned(["./main", "0"], cwd, { ...bunEnv, BUN_JSC_aotCountsPath: counts });
    expect(idle).toEqual({ stdout: "0 0 0 0 0 0 0 0\n", stderr: "", exitCode: 0, signal: null });
    expect(flattenings(counts)).toBe(0);
    const read = await spawned(["./main", "2"], cwd, { ...bunEnv, BUN_JSC_aotCountsPath: counts });
    expect(read).toEqual({ stdout: "195 195 195 195 390 2 197 391\n", stderr: "", exitCode: 0, signal: null });
    expect(flattenings(counts)).toBe(8);
  }, 120_000);
});
