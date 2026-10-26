import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { measureCommand } from "./analysis-scaling/measure-check";
import { withThreads } from "./harness/flags";
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

// The `try` block stores to every local, the `catch` block reads every local, and the second call throws halfway.
function writeLocalsStoredInTry(localCount: number): Program {
  const indexes = indexesUpTo(localCount);
  const lastStored = localCount >> 1;
  const sumOfCatch = indexes.reduce((sum, index) => mix(sum, index <= lastStored ? index * 7 + 1 : 0), 1);
  return {
    source: [
      "function mix(sum, value) { return (sum * 33 + value) % 1000000007; }",
      "function run(numbers, throws) {",
      "let sum = 1;",
      ...indexes.map(index => `let local${index} = 0;`),
      "try {",
      ...indexes.map(
        index => `local${index} = numbers[${index}];${index === lastStored ? " if (throws) throw 0;" : ""}`,
      ),
      "} catch {",
      ...indexes.map(index => `sum = mix(sum, local${index});`),
      "}",
      `return mix(sum, local0 + local${localCount - 1});`,
      "}",
      "const numbers = [];",
      `for (let index = 0; index < ${localCount}; index++) numbers.push(index * 7 + 1);`,
      "console.log(run(numbers, false), run(numbers, true));",
    ].join("\n"),
    output: `${mix(1, 1 + (localCount - 1) * 7 + 1)} ${mix(sumOfCatch, 1)}\n`,
  };
}

async function instructionsOfBuild(program: Program) {
  using dir = tempDir("aot-long-functions-counted", { "main.js": program.source });
  const cwd = String(dir);
  const command = [bunExe(), "build", "--compile", "--aot", withThreads(1), "./main.js", "--outfile", "./main"];
  const { instructions } = await measureCommand(cwd, command, 200_000);
  await using ran = Bun.spawn({ cmd: ["./main"], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [output, errors, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  expect({ output, errors, exitCode }).toEqual({ output: program.output, errors: "", exitCode: 0 });
  return instructions;
}

// Instructions on one thread are the same at any load, so the bound is closer to four than a bound on time can be.
// What a build of nothing costs is left out.
async function expectLinearInstructionCount(
  few: number,
  writeProgramOfSize: (size: number) => Program,
  mostGrowth: number,
) {
  const programs = [{ source: "console.log(0);", output: "0\n" }, writeProgramOfSize(few), writeProgramOfSize(4 * few)];
  const [withNone, withFew, withMany] = await Promise.all(programs.map(instructionsOfBuild));
  if (withNone === undefined || withFew === undefined || withMany === undefined) return;
  expect((withMany - withNone) / (withFew - withNone)).toBeLessThan(mostGrowth);
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
  "the instructions of a build are nearly linear in the number of locals a try block stores to",
  async () => {
    await expectLinearInstructionCount(1_000, writeLocalsStoredInTry, 6.5);
  },
  240_000,
);
