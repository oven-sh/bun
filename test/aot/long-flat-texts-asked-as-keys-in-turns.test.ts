// A long flat text that is asked as a key of an object is held against the name of the same length, character by character.
// Asked a second time it becomes the name's atom. Several such texts asked in turns each become atoms: what was compared last is remembered with each name.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const program = `const head = "x".repeat(20_000);
const tails: string[] = JSON.parse('["a","bb","ccc","dddd"]');
const cache: Record<string, number> = {};
tails.forEach((tail, k) => (cache[head + tail] = k + 1));
const kept: string[] = JSON.parse(JSON.stringify(tails.map(tail => head + tail)));
const turns: number = JSON.parse(process.argv[2]!);
let sum = 0;
for (let i = 0; i < turns; i++) sum += cache[kept[i & 3]!]!;
console.log(sum, kept[1]!.length, kept[1]!.charCodeAt(20_001), kept[1] === head + "bb");
`;

describe("compile/aot/long-flat-texts-asked-as-keys-in-turns", () => {
  test("each is compared with its name twice", async () => {
    using dir = tempDir("aot-long-flat-texts-asked-as-keys-in-turns", { "main.ts": program });
    const cwd = String(dir);
    built(
      await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", join(cwd, "main")], cwd, bunEnv),
    );
    const counts = join(cwd, "counts");
    const ran = await spawned(["./main", "4000"], cwd, { ...bunEnv, BUN_JSC_aotCountsPath: counts });
    expect(ran).toEqual({ stdout: "10000 20002 98 true\n", stderr: "", exitCode: 0, signal: null });
    const compared = readFileSync(counts, "utf8")
      .split("\n")
      .map(line => line.split("\t"))
      .filter(([, name]) => name === "counter:LongKeysComparedWithNames")
      .map(([count]) => Number(count));
    expect(compared).toEqual([4 * 2]);
  }, 120_000);
});
