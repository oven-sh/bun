import { isASAN, isDebug, isWindows } from "harness";
import { expectLinearInstructionCount } from "./long-functions-instructions";
import { indexesUpTo, mix, type Program } from "./long-functions-programs";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;

const seed = 1.5;

type Locals = {
  first: (index: number) => number | "seed";
  writeNext: (local: string, from: number) => string;
  next: (local: number, from: number) => number;
};

const addElementsOfTwoArrays: Locals = {
  first: () => 0,
  writeNext: (local, from) => `${local} + ${from % 2 ? "doubles" : "integers"}[${from}]`,
  next: (local, from) => local + (from % 2 ? from + 0.5 : from * 3),
};

const addElementsOfOneArrayTimesParameter: Locals = {
  first: () => "seed",
  writeNext: (local, from) => `${local} + doubles[${from}] * seed`,
  next: (local, from) => local + (from + 0.5) * seed,
};

const addElementsOfOneArrayAsInt32: Locals = {
  first: index => index % 5,
  writeNext: (local, from) => `(${local} + integers[${from}]) | 0`,
  next: (local, from) => (local + from * 3) | 0,
};

// Each turn of one loop adds an element of a typed array to every local, and then every local is used once.
function writeLocalsCarriedAroundLoop(localCount: number, locals: Locals): Program {
  const indexes = indexesUpTo(localCount);
  const turns = [0, 1, 2];
  const readBy = (index: number) => (index + 1) % localCount;
  const firstValue = (index: number) => (locals.first(index) === "seed" ? seed : (locals.first(index) as number));
  const lastValue = (index: number) => turns.reduce(local => locals.next(local, readBy(index)), firstValue(index));
  const sumAfterLoop = turns.reduce((sum, turn) => mix(sum, turn), 1);
  return {
    source: [
      "function mix(sum, value) { return (sum * 33 + value) % 1000000007; }",
      "function run(doubles, integers, seed) {",
      "let sum = 1;",
      ...indexes.map(index => `let local${index} = ${locals.first(index)};`),
      `for (let turn = 0; turn < ${turns.length}; turn++) {`,
      ...indexes.map(index => `local${index} = ${locals.writeNext(`local${index}`, readBy(index))};`),
      "sum = mix(sum, turn);",
      "}",
      ...indexes.map(index => `sum = mix(sum, local${index} * 2);`),
      "return sum;",
      "}",
      `const doubles = new Float64Array(${localCount}), integers = new Int32Array(${localCount});`,
      `for (let index = 0; index < ${localCount}; index++) { doubles[index] = index + 0.5; integers[index] = index * 3; }`,
      `console.log(run(doubles, integers, ${seed}));`,
    ].join("\n"),
    output: `${indexes.reduce((sum, index) => mix(sum, lastValue(index) * 2), sumAfterLoop)}\n`,
  };
}

test.skipIf(isSlowBuild || isWindows).each([
  ["that add elements of two arrays in turn", addElementsOfTwoArrays],
  ["that begin as one parameter and add elements of one array", addElementsOfOneArrayTimesParameter],
  ["that stay int32 and add elements of one array", addElementsOfOneArrayAsInt32],
])(
  "the instructions of a build are linear in the number of locals carried around a loop %s",
  async (_, locals) => {
    await expectLinearInstructionCount(2_000, localCount => writeLocalsCarriedAroundLoop(localCount, locals), 4.5);
  },
  240_000,
);
