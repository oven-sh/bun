import { isASAN, isDebug } from "harness";
import { countsInstructions } from "./analysis-scaling/measure-check";
import { buildFlags } from "./harness/flags";
import { expectLinearInstructionCount } from "./long-functions-instructions";
import { indexesUpTo, type Program } from "./long-functions-programs";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;

// The body of the module calls one small function on two elements of one array, over and over. Each call reads again what the
// first has read and nothing writes: where the array keeps its elements, how many there are.
function writeCallsOnElementsOfOneArray(callCount: number): Program {
  const values = [0, 1, -1, 0.5, "a", "7", null, undefined, true];
  const operandsOf = (index: number) => [index % values.length, (index * 7 + 3) % values.length];
  const [left, right] = operandsOf(callCount - 1);
  return {
    source: [
      'const values = [0, 1, -1, 0.5, "a", "7", null, undefined, true];',
      "function told(a, b) { try { return String(a + b); } catch (error) { return error.name; } }",
      "const all = [",
      ...indexesUpTo(callCount).map(index => `told(values[${operandsOf(index).join("], values[")}]),`),
      "];",
      "console.log(all.length, all[all.length - 1]);",
    ].join("\n"),
    output: `${callCount} ${String((values[left] as any) + (values[right] as any))}\n`,
  };
}

test.skipIf(isSlowBuild || !countsInstructions())(
  "the instructions of a build that checks the back end after each phase are linear in the length of a function",
  async () => {
    // As counted on Linux: x64 4.02 times, and 4.00 times from 1,600 calls to 6,400; arm64 4.57 times, then 3.58 times: dearer in the middle, squared nowhere.
    await expectLinearInstructionCount(400, writeCallsOnElementsOfOneArray, process.arch === "arm64" ? 4.7 : 4.5, [
      buildFlags.validateBackEnd,
      buildFlags.validate,
    ]);
  },
  240_000,
);
