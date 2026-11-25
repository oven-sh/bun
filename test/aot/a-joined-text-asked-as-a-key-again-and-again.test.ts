// A long joined text that is asked as a key of an object is held against the name of the same length, character by character.
// Once it has been found equal it takes the name's characters, so the same text asked again costs nothing of its size.
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
const kept: string[] = tails.map(tail => head + tail);
const wide: Record<string, number> = { [head + "\\u4e2d"]: 9 };
const keptWide = head + JSON.parse('"\\\\u4e2d"');
const turns: number = JSON.parse(process.argv[2]!);
let sum = 0;
for (let i = 0; i < turns; i++) sum += cache[kept[0]!]!;
for (let i = 0; i < turns; i++) sum += cache[kept[i & 3]!]!;
for (let i = 0; i < turns; i++) sum += wide[keptWide]!;
for (let i = 0; i < turns; i++) sum += cache[head + tails[i & 3]!]!;
for (let i = 0; i < turns; i++) sum += cache[kept[i & 3]! + "e"] ?? 7;
console.log(sum, kept[1]!.length, kept[1]!.charCodeAt(20_001), kept[1] === head + "bb", keptWide.charCodeAt(20_000));
`;

describe("compile/aot/a-joined-text-asked-as-a-key-again-and-again", () => {
  test("is compared with the name once", async () => {
    using dir = tempDir("aot-a-joined-text-asked-as-a-key-again-and-again", { "main.ts": program });
    const cwd = String(dir);
    built(
      await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", join(cwd, "main")], cwd, bunEnv),
    );
    const counts = join(cwd, "counts");
    const ran = await spawned(["./main", "400"], cwd, { ...bunEnv, BUN_JSC_aotCountsPath: counts });
    expect(ran).toEqual({ stdout: "8800 20002 98 true 20013\n", stderr: "", exitCode: 0, signal: null });
    const compared = readFileSync(counts, "utf8")
      .split("\n")
      .map(line => line.split("\t"))
      .filter(([, name]) => name === "counter:LongKeysComparedWithNames")
      .map(([count]) => Number(count));
    const keptOnce = 4 + 1,
      joinedAnew = 400,
      asLongAsAnotherName = 300;
    expect(compared).toEqual([keptOnce + joinedAnew + asLongAsAnotherName]);
  }, 120_000);
});
