import { isASAN, isDebug, isWindows } from "harness";
import { expectLinearInstructionCount } from "./long-functions-instructions";
import { indexesUpTo, mix, type Program } from "./long-functions-programs";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;

// Every local is loaded from one of two arrays, a call of a function picked at run time follows each load, and then every local is used once.
function writeLoadsWithCallsBetween(localCount: number): Program {
  const indexes = indexesUpTo(localCount);
  const valueAt = (index: number) => (index % 3 ? index + 0.25 : index * 7);
  const sum = indexes.reduce((sum, index) => mix(sum, valueAt(index) * 4), 1);
  return {
    source: [
      "const fractions = [], integers = [];",
      `for (let index = 0; index < ${localCount}; index++) { fractions.push(index + 0.25); integers.push(index * 7); }`,
      "const log = [];",
      "const notes = [index => { log.push(index); }, index => { log.length = 0; }];",
      "function mix(sum, value) { return (sum * 33 + value) % 1000000007; }",
      "function run(fractions, integers, clears) {",
      "let sum = 1;",
      "const note = notes[clears ? 1 : 0];",
      ...indexes.map(
        index => `const local${index} = ${index % 3 ? "fractions" : "integers"}[${index}]; note(${index});`,
      ),
      ...indexes.map(index => `sum = mix(sum, local${index} * 4);`),
      "return sum + log.length;",
      "}",
      "console.log(run(fractions, integers, false), run(fractions, integers, true));",
    ].join("\n"),
    output: `${sum + localCount} ${sum}\n`,
  };
}

test.skipIf(isSlowBuild || isWindows)(
  "the instructions of a build are linear in the number of loads with a call between them",
  async () => {
    await expectLinearInstructionCount(2_000, writeLoadsWithCallsBetween, 4.5);
  },
  240_000,
);
