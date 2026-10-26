import { isASAN, isDebug, isWindows } from "harness";
import { expectLinearInstructionCount } from "./long-functions-instructions";
import { indexesUpTo, mix, type Program } from "./long-functions-programs";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;

// Each turn of one loop adds an element of a typed array to every local, and then every local is used once.
function writeLocalsCarriedAroundLoop(localCount: number): Program {
  const indexes = indexesUpTo(localCount);
  const turns = [0, 1, 2];
  const elementAt = (index: number) => (index % 2 ? index + 0.5 : index * 3);
  const sumAfterLoop = turns.reduce((sum, turn) => mix(sum, turn), 1);
  return {
    source: [
      "function mix(sum, value) { return (sum * 33 + value) % 1000000007; }",
      "function run(doubles, integers) {",
      "let sum = 1;",
      ...indexes.map(index => `let local${index} = 0;`),
      `for (let turn = 0; turn < ${turns.length}; turn++) {`,
      ...indexes.map(index => {
        const from = (index + 1) % localCount;
        return `local${index} = local${index} + ${from % 2 ? "doubles" : "integers"}[${from}];`;
      }),
      "sum = mix(sum, turn);",
      "}",
      ...indexes.map(index => `sum = mix(sum, local${index} * 2);`),
      "return sum;",
      "}",
      `const doubles = new Float64Array(${localCount}), integers = new Int32Array(${localCount});`,
      `for (let index = 0; index < ${localCount}; index++) { doubles[index] = index + 0.5; integers[index] = index * 3; }`,
      "console.log(run(doubles, integers));",
    ].join("\n"),
    output: `${indexes.reduce((sum, index) => mix(sum, turns.length * elementAt((index + 1) % localCount) * 2), sumAfterLoop)}\n`,
  };
}

test.skipIf(isSlowBuild || isWindows)(
  "the instructions of a build are linear in the number of locals carried around a loop",
  async () => {
    await expectLinearInstructionCount(2_000, writeLocalsCarriedAroundLoop, 4.5);
  },
  240_000,
);
