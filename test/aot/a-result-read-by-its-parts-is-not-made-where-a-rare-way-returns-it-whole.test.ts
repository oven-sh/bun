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

const boundsOfPair = `function bounds(list: number[]): [number, number] {
  let low = 1000;
  for (let i = 0; i < list.length; i++) if (list[i] < low) low = list[i];
  let high = -1000;
  for (let i = 0; i < list.length; i++) if (list[i] > high) high = list[i];
  return [low, high];
}
`;
const turns = (body: string) => `const data: number[] = [3, 1, 2];
let total = 0;
for (let i = 0; i < 20_000_000; i++) {
  data[i % 3] = i & 7;
  ${body}
}
console.log(total);
`;

// An element of the pair may be undefined (an element that is missing from the list), and its readers expect storage for numbers alone.
// In the loop of the module the pair also meets the result of the call that a way which seldom runs makes.
const sourceWithPair = boundsOfPair + turns("const [low, high] = bounds(data);\n  total += high - low;");
const sourceWithPairInFunction =
  boundsOfPair +
  "function spread(list: number[]): number {\n  const [low, high] = bounds(list);\n  return high - low;\n}\n" +
  turns("total += spread(data);");
const sourceWithAssignedPair =
  boundsOfPair +
  "function spread(list: number[]): number {\n  let low = 0, high = 0;\n  [low, high] = bounds(list);\n  return high - low;\n}\n" +
  turns("total += spread(data);");
const sourceWithIndexes =
  boundsOfPair +
  "function spread(list: number[]): number {\n  const both = bounds(list);\n  return both[1] - both[0] + bounds(list)[1];\n}\n" +
  turns("total += spread(data);");
const sourceWithSmallFunction =
  "function divide(a: number, b: number): [number, number] {\n  return [Math.floor(a / b), a % b];\n}\n" +
  turns("const [quotient, rest] = divide(i, 7);\n  total += quotient - rest;");
const sourceWithLocalList = turns("const pair = [i * 0.5, i + 1];\n  total += pair[0] - pair[1];");

// Behind the block where the parts and the whole object of the call meet, a second block takes in the result of the call that seldom runs.
const sourceInLoopOfModule =
  source.slice(0, source.indexOf("function spread")) +
  turns("const { low, high } = bounds(data);\n  total += high - low;");

// Each element is read once and compared twice, and a second loop compares the elements with a constant.
const sourceWithElementsReadOnce =
  `function bounds(list: number[]) {
  let low = 1000, high = -1000;
  for (let i = 0; i < list.length; i++) {
    const value = list[i];
    if (value < low) low = value;
    if (value > high) high = value;
  }
  for (let i = 0; i < list.length; i++) if (list[i] === 99) high = 99;
  return { low, high };
}
` + turns("const { low, high } = bounds(data);\n  total += high - low;");

describe("compile/aot/results read by their parts", () => {
  for (const [title, text, run] of [
    ["the object is made on no way that runs often", source, test],
    ["the pair is made on no way that runs often", sourceWithPair, test],
    ["the pair that a function takes apart", sourceWithPairInFunction, test],
    ["the pair that is assigned to variables", sourceWithAssignedPair, test],
    ["the pair that is read by index", sourceWithIndexes, test],
    ["the pair of a small function", sourceWithSmallFunction, test],
    ["a list of numbers that is only read", sourceWithLocalList, test],
    ["the object that the loop of the module takes apart", sourceInLoopOfModule, test],
    ["the object of a function that reads each element once", sourceWithElementsReadOnce, test],
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
