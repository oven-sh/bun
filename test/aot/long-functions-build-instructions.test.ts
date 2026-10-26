import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { expectLinearInstructionCount } from "./long-functions-instructions";
import {
  indexesUpTo,
  mix,
  writeClassWithMethods,
  writeLocalsReadInCatch,
  type Program,
} from "./long-functions-programs";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;

// Each local holds an object of its own, and the last statement reads a property of every one of them.
function writeLocalsThatHoldResultsOfCalls(localCount: number): Program {
  const indexes = indexesUpTo(localCount);
  let seed = 1;
  let sum = 0;
  for (let index = 0; index < localCount; index++) {
    seed = (seed * 48271) % 2147483647;
    sum += seed % 3;
  }
  return {
    source: [
      "let seed = 1;",
      "function next() { seed = (seed * 48271) % 2147483647; return { seed }; }",
      "function run() {",
      ...indexes.map(index => `const local${index} = next();`),
      `return ${indexes.map(index => `local${index}.seed % 3`).join(" + ")};`,
      "}",
      "console.log(run());",
    ].join("\n"),
    output: `${sum}\n`,
  };
}

// Every second local is loaded from an array of doubles, the others from an array of integers, and the last statement adds all of them.
function writeLocalsLoadedFromTypedArrays(localCount: number): Program {
  const indexes = indexesUpTo(localCount);
  return {
    source: [
      "function run(doubles, integers) {",
      ...indexes.map(index => `const local${index} = ${index % 2 ? "doubles" : "integers"}[${index}];`),
      `return ${indexes.map(index => `local${index}`).join(" + ")};`,
      "}",
      `const doubles = new Float64Array(${localCount}), integers = new Int32Array(${localCount});`,
      `for (let index = 0; index < ${localCount}; index++) { doubles[index] = index + 0.5; integers[index] = index; }`,
      "console.log(run(doubles, integers));",
    ].join("\n"),
    output: `${indexes.reduce((sum, index) => sum + (index % 2 ? index + 0.5 : index), 0)}\n`,
  };
}

// Every local is loaded from one of two arrays of numbers, and then every local is used once.
function writeLocalsLoadedFromArrays(localCount: number): Program {
  const indexes = indexesUpTo(localCount);
  const valueAt = (index: number) => (index % 3 ? index + 0.25 : index * 7);
  return {
    source: [
      "const fractions = [], integers = [];",
      `for (let index = 0; index < ${localCount}; index++) { fractions.push(index + 0.25); integers.push(index * 7); }`,
      "function mix(sum, value) { return (sum * 33 + value) % 1000000007; }",
      "function run(fractions, integers, first) {",
      "let sum = first;",
      ...indexes.map(index => `const local${index} = ${index % 3 ? "fractions" : "integers"}[${index}];`),
      ...indexes.map(index => `sum = mix(sum, local${index} * 4);`),
      "return sum;",
      "}",
      "console.log(run(fractions, integers, 1), run(fractions, integers, 2));",
    ].join("\n"),
    output: `${[1, 2].map(first => indexes.reduce((sum, index) => mix(sum, valueAt(index) * 4), first)).join(" ")}\n`,
  };
}

// Every object is filled by name behind its empty literal, and holds the object made before it.
function writeObjectsThatHoldTheOneBefore(objectCount: number): Program {
  const indexes = indexesUpTo(objectCount);
  const last = objectCount - 1;
  return {
    source: [
      "function make() {",
      ...indexes.map(
        index =>
          `const object${index} = {}; object${index}.index = ${index}; object${index}.text = "text ${index}"; ` +
          `object${index}.previous = ${index ? `object${index - 1}` : "null"};`,
      ),
      `return object${last};`,
      "}",
      "const made = make();",
      "console.log(made.index, made.text, made.previous.index, made.previous.previous.text);",
    ].join("\n"),
    output: `${last} text ${last} ${last - 1} text ${last - 2}\n`,
  };
}

async function codeBytesOfFunction(program: Program, name: string) {
  using dir = tempDir("aot-long-functions-code-bytes", { "main.js": program.source });
  const cwd = String(dir);
  const flags = ["--aot-report=./report.json", "--aot-report-detail=functions"];
  const cmd = [bunExe(), "build", "--compile", "--aot", ...flags, "./main.js", "--outfile", "./main"];
  await using built = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "ignore", stderr: "pipe" });
  expect({ errors: await built.stderr.text(), exitCode: await built.exited }).toMatchObject({ exitCode: 0 });
  const { functions } = (await Bun.file(`${cwd}/report.json`).json()) as {
    functions: { name: string; codeBytes: number }[];
  };
  return functions.filter(it => it.name === name).reduce((sum, it) => sum + it.codeBytes, 0);
}

test.skipIf(isSlowBuild || isWindows)(
  "the instructions of a build are linear in the number of methods of a class",
  async () => {
    await expectLinearInstructionCount(30_000, writeClassWithMethods, 4.5);
  },
  240_000,
);

test.skipIf(isSlowBuild || isWindows)(
  "the instructions of a build are linear in the number of locals a catch block reads",
  async () => {
    await expectLinearInstructionCount(16_000, writeLocalsReadInCatch, 4.5);
  },
  240_000,
);

test.skipIf(isSlowBuild || isWindows)(
  "the instructions of a build are nearly linear in the number of locals loaded from typed arrays",
  async () => {
    await expectLinearInstructionCount(5_000, writeLocalsLoadedFromTypedArrays, 5.5);
  },
  240_000,
);

test.skipIf(isSlowBuild || isWindows)(
  "the instructions of a build are linear in the number of locals that hold results of calls",
  async () => {
    await expectLinearInstructionCount(15_000, writeLocalsThatHoldResultsOfCalls, 4.5);
  },
  240_000,
);

test.skipIf(isSlowBuild || isWindows)(
  "the instructions of a build are nearly linear in the number of locals loaded from arrays",
  async () => {
    await expectLinearInstructionCount(8_000, writeLocalsLoadedFromArrays, 5.5);
  },
  240_000,
);

test.skipIf(isSlowBuild || isWindows)(
  "the instructions of a build are nearly linear in the number of locals loaded from arrays, from sixty locals on",
  async () => {
    await expectLinearInstructionCount(60, writeLocalsLoadedFromArrays, 5.5);
  },
  240_000,
);

test.skipIf(isSlowBuild)(
  "the code of a function is linear in the number of locals loaded from arrays",
  async () => {
    const [withFew, withMany] = await Promise.all(
      [60, 240].map(localCount => codeBytesOfFunction(writeLocalsLoadedFromArrays(localCount), "run")),
    );
    expect(withFew).toBeGreaterThan(0);
    expect(withMany / withFew).toBeLessThan(5);
  },
  240_000,
);

test.skipIf(isSlowBuild || isWindows)(
  "the instructions of a build are linear in the number of objects that each hold the one before",
  async () => {
    await expectLinearInstructionCount(8_000, writeObjectsThatHoldTheOneBefore, 4.5);
  },
  240_000,
);
