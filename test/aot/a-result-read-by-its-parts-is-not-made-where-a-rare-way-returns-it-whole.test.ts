// A function too large to inline answers with a literal, and its caller only reads the members. The function hands the members
// over one by one. Here one way through it that seldom runs (an element that is missing from the list) stores a value that its
// field does not hold, so on that way it hands over the object. The caller must not make the object on the other way only
// because the two ways meet in front of the reads: twenty million calls would keep the collector busy.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { built, slot, spawned, told } from "./run-programs";
import { describe, test } from "./supported";

const source = `function bounds(list: number[]) {
  let low = 1000;
  for (let i = 0; i < list.length; i++) if (list[i] < low) low = list[i];
  let high = -1000;
  for (let i = 0; i < list.length; i++) if (list[i] > high) high = list[i];
  return { low, high };
}
function spread(list: number[]): number {
  const both = bounds(list);
  return both.high - both.low;
}
const data: number[] = [3, 1, 2];
let total = 0;
for (let i = 0; i < 20_000_000; i++) {
  data[i % 3] = i & 7;
  total += spread(data);
}
console.log(total);
`;

// TODO: the pair is still made on every call: in the loop of the module it meets the result of the call that a way which seldom runs makes.
const sourceWithPair = `function bounds(list: number[]): [number, number] {
  let low = 1000;
  for (let i = 0; i < list.length; i++) if (list[i] < low) low = list[i];
  let high = -1000;
  for (let i = 0; i < list.length; i++) if (list[i] > high) high = list[i];
  return [low, high];
}
const data: number[] = [3, 1, 2];
let total = 0;
for (let i = 0; i < 20_000_000; i++) {
  data[i % 3] = i & 7;
  const [low, high] = bounds(data);
  total += high - low;
}
console.log(total);
`;

describe("compile/aot/results read by their parts", () => {
  for (const [title, text, run] of [
    ["the object is made on no way that runs often", source, test],
    ["the pair is made on no way that runs often", sourceWithPair, test.todo],
  ] as const)
    run(title, () =>
      slot(async () => {
        using dir = tempDir("aot-results-read-by-their-parts", { "main.ts": text });
        const folder = String(dir);
        const executable = join(folder, "main" + (isWindows ? ".exe" : ""));
        const env = { ...bunEnv, NO_COLOR: "1" };
        built(await spawned([bunExe(), ...compileCommand, "main.ts", "--outfile", executable], folder, env));
        const ran = await spawned([executable], folder, env);
        expect(told(ran)).toEqual(told(await spawned([bunExe(), "main.ts"], folder, env)));
        // Twenty million objects of 32 bytes were over four hundred collections.
        const logged = await spawned([executable], folder, { ...env, BUN_JSC_logGC: "1" });
        expect(logged.exitCode).toBe(0);
        expect((logged.stdout + logged.stderr).split("\n").filter(line => /GC\b/.test(line)).length).toBeLessThan(20);
      }),
    );
});
