// A text joined in every turn out of what no turn changes is made once, in front of the loop. There it stays as it was joined:
// to make it flat is work and memory of the size of the text, and the first turn may leave ahead of whoever reads its characters.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const program = `function doubled(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
const among: string[] = JSON.parse('["x","y","z"]');
function behindBreak(lines: string[], name: string, tail: string, stop: boolean): number {
  let sum = 0;
  for (let k = 0; k < lines.length; k++) {
    if (stop) break;
    sum += (name + "-" + tail).charCodeAt(k);
  }
  return sum;
}
function behindReturn(lines: string[], name: string, tail: string, stop: boolean): number {
  let sum = 0;
  for (let k = 0; k < lines.length; k++) {
    if (stop) return -1;
    sum += (name + "-" + tail).charCodeAt(k);
  }
  return sum;
}
function joinedFirst(lines: string[], name: string, tail: string, stop: boolean): number {
  let sum = 0;
  for (let k = 0; k < lines.length; k++) {
    const joined = name + "-" + tail;
    if (stop) break;
    sum += joined.charCodeAt(k);
  }
  return sum;
}
const stop: boolean = JSON.parse(process.argv[2]!);
const text = () => doubled(JSON.parse('"ab"'), 10);
console.log(behindBreak(among, text(), text(), stop), behindReturn(among, text(), text(), stop), joinedFirst(among, text(), text(), stop));
`;

function flattenings(counts: string): number {
  return readFileSync(counts, "utf8")
    .split("\n")
    .map(line => line.split("\t"))
    .filter(([, name]) => name === "operation:operationAOTFlatten")
    .reduce((sum, [count]) => sum + Number(count), 0);
}

describe("compile/aot/a-text-joined-in-front-of-a-loop-whose-first-turn-leaves", () => {
  test("is made flat only by a turn that reads it", async () => {
    using dir = tempDir("aot-a-text-joined-in-front-of-a-loop-whose-first-turn-leaves", { "main.ts": program });
    const cwd = String(dir);
    built(
      await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", join(cwd, "main")], cwd, bunEnv),
    );
    const counts = join(cwd, "counts");
    const left = await spawned(["./main", "true"], cwd, { ...bunEnv, BUN_JSC_aotCountsPath: counts });
    expect(left).toEqual({ stdout: "0 -1 0\n", stderr: "", exitCode: 0, signal: null });
    expect(flattenings(counts)).toBe(0);
    const read = await spawned(["./main", "false"], cwd, { ...bunEnv, BUN_JSC_aotCountsPath: counts });
    expect(read).toEqual({ stdout: "292 292 292\n", stderr: "", exitCode: 0, signal: null });
    expect(flattenings(counts)).toBe(3);
  }, 120_000);
});
