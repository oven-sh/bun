import { isASAN, isDebug, isWindows } from "harness";
import { expectLinearInstructionCount } from "./long-functions-instructions";
import { indexesUpTo, type Program } from "./long-functions-programs";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;

// Every statement reads one variable, which starts as a parameter without a type, and adds to it.
function writeAdditionsToOneVariable(count: number): Program {
  const indexes = indexesUpTo(count);
  return {
    source: [
      "const pass = value => value;",
      "function run(seed) {",
      "let sum = seed;",
      ...indexes.map(index => `sum += pass(sum + ${index}) % 5;`),
      "return sum;",
      "}",
      "console.log(run(1));",
    ].join("\n"),
    output: `${indexes.reduce((sum, index) => sum + ((sum + index) % 5), 1)}\n`,
  };
}

test.skipIf(isSlowBuild || isWindows).each([500, 1_000])(
  "the instructions of a build are linear in the number of compound assignments to a variable, from %d on",
  async count => {
    await expectLinearInstructionCount(count, writeAdditionsToOneVariable, 4.5);
  },
  240_000,
);
