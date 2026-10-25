import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { measureUntilWithinBounds } from "./harness/measure-again";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;

type Program = { source: string; output: string };

const indexesUpTo = (count: number) => Array.from({ length: count }, (_, index) => index);

function writeStoresToOneObject(storeCount: number): Program {
  return {
    source: [
      "const table = {};",
      ...indexesUpTo(storeCount).map(index => `table.k${index} = ${index};`),
      `console.log(Object.keys(table).length, table.k7, table.k${storeCount - 1});`,
    ].join("\n"),
    output: `${storeCount} 7 ${storeCount - 1}\n`,
  };
}

const scramble = (index: number) => (index * 31 + 7) | 0;
const mix = (sum: number, value: number) => (sum * 33 + value) % 1000000007;

// The `try` block has as many calls as there are locals in front of it, and the `catch` block reads every local.
function writeLocalsReadInCatch(localCount: number): Program {
  const indexes = indexesUpTo(localCount);
  const sumOfTry = indexes.reduce((sum, index) => mix(sum, scramble(index)), 1);
  const sumOfCatch = indexes.reduceRight((sum, index) => mix(sum, scramble(index)), sumOfTry);
  return {
    source: [
      `const scramble = ${scramble};`,
      `const mix = ${mix};`,
      "function run(throws) {",
      "let sum = 1;",
      ...indexes.map(index => `const local${index} = scramble(${index});`),
      "try {",
      ...indexes.map(index => `sum = mix(sum, scramble(${index}));`),
      'if (throws) throw new Error("thrown");',
      "} catch {",
      ...indexes.map(index => `sum = mix(sum, local${index});`).reverse(),
      "}",
      "return sum;",
      "}",
      "console.log(run(false), run(true));",
    ].join("\n"),
    output: `${sumOfTry} ${sumOfCatch}\n`,
  };
}

function writeArrayOfSums(elementCount: number): Program {
  return {
    source: [
      "const one = Date.now() > 0 ? 1 : 2;",
      `const sums = [${indexesUpTo(elementCount)
        .map(index => `one + ${index}`)
        .join(", ")}];`,
      `console.log(sums.length, sums[7], sums[${elementCount - 1}]);`,
    ].join("\n"),
    output: `${elementCount} 8 ${elementCount}\n`,
  };
}

// Whole numbers, fractions, holes, NaN, -0, Infinity and a value that is made before all the others.
function writeArrayOfAllKindsOfNumbers(elementCount: number): string {
  const kinds = ["one + $", "half + $", "", "zero / zero", "-zero", "early", "one * 1e300 * 1e10"];
  return [
    "const one = Date.now() > 0 ? 1 : 2, half = one / 2, zero = one - 1, early = one * 41;",
    `const numbers = [${indexesUpTo(elementCount)
      .map(index => kinds[index % kinds.length].replace("$", String(index)))
      .join(", ")}, one];`,
    "let holes = 0, notNumbers = 0, negativeZeros = 0, sum = 0;",
    "for (let index = 0; index < numbers.length; index++) {",
    "  const number = numbers[index];",
    "  if (!(index in numbers)) holes++;",
    "  else if (number !== number) notNumbers++;",
    "  else if (Object.is(number, -0)) negativeZeros++;",
    "  else if (number !== Infinity) sum += number;",
    "}",
    "console.log(numbers.length, holes, notNumbers, negativeZeros, sum, numbers.slice(0, 8), numbers.at(-1));",
  ].join("\n");
}

// The first element is known only when the program runs, so the array is made by code.
function writeArrayOfTexts(elementCount: number): Program {
  const texts = indexesUpTo(elementCount).map(index => `sentence number ${index}`);
  return {
    source: [
      `const texts = [Date.now() > 0 ? "first" : "never", ${texts.map(text => JSON.stringify(text)).join(", ")}];`,
      `console.log(texts.length, texts[0], texts[8], texts[${elementCount}]);`,
    ].join("\n"),
    output: `${elementCount + 1} first ${texts[7]} ${texts[elementCount - 1]}\n`,
  };
}

function writeClassWithMethods(methodCount: number): Program {
  return {
    source: [
      `class Table { ${indexesUpTo(methodCount)
        .map(index => `k${index}() { return ${index}; }`)
        .join(" ")} }`,
      "const table = new Table();",
      `console.log(Object.getOwnPropertyNames(Table.prototype).length, table.k7(), table.k${methodCount - 1}());`,
    ].join("\n"),
    output: `${methodCount + 1} 7 ${methodCount - 1}\n`,
  };
}

async function processorSecondsOfBuild(program: Program) {
  using dir = tempDir("aot-long-functions", { "main.js": program.source });
  await using built = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", "./main"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([built.stdout.text(), built.stderr.text(), built.exited]);
  expect({ output: exitCode ? stdout + stderr : "", exitCode }).toEqual({ output: "", exitCode: 0 });

  await using ran = Bun.spawn({ cmd: ["./main"], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [output, errors, exitCodeOfRun] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  expect({ output, errors, exitCode: exitCodeOfRun }).toEqual({ output: program.output, errors: "", exitCode: 0 });
  return Number(built.resourceUsage()!.cpuTime.user) / 1e6;
}

// Four times the program takes four times as long where the time is linear, and sixteen times as long where it is quadratic.
async function expectLinearBuildTime(name: string, few: number, writeProgramOfSize: (size: number) => Program) {
  const growth = await measureUntilWithinBounds(
    name,
    async () => {
      const withFew = await processorSecondsOfBuild(writeProgramOfSize(few));
      const withMany = await processorSecondsOfBuild(writeProgramOfSize(4 * few));
      return withMany / withFew;
    },
    growth => growth < 6,
  );
  expect(growth).toBeLessThan(6);
}

test("build time is linear in the number of stores to properties of one object", async () => {
  await expectLinearBuildTime("stores to one object", isSlowBuild ? 4_000 : 15_000, writeStoresToOneObject);
}, 240_000);

test("build time is linear in the number of locals a catch block reads", async () => {
  await expectLinearBuildTime("locals read in a catch block", isSlowBuild ? 1_000 : 4_000, writeLocalsReadInCatch);
}, 240_000);

test.skipIf(isSlowBuild)(
  "a function builds when its catch block reads 56,000 locals",
  async () => {
    await processorSecondsOfBuild(writeLocalsReadInCatch(56_000));
  },
  240_000,
);

test("build time is linear in the number of computed elements of an array literal", async () => {
  await expectLinearBuildTime("computed elements of an array literal", isSlowBuild ? 4_000 : 15_000, writeArrayOfSums);
}, 240_000);

test.skipIf(isSlowBuild)(
  "build time is linear in the number of computed numbers of a very long array literal",
  async () => {
    await expectLinearBuildTime("computed numbers of a very long array literal", 40_000, writeArrayOfSums);
  },
  240_000,
);

test.skipIf(isSlowBuild)(
  "a very long array literal holds every kind of number and its holes",
  async () => {
    const source = writeArrayOfAllKindsOfNumbers(21_000);
    using dir = tempDir("aot-long-functions-plain", { "main.js": source });
    await using ran = Bun.spawn({
      cmd: [bunExe(), "./main.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [output, exitCode] = await Promise.all([ran.stdout.text(), ran.exited]);
    expect(exitCode).toBe(0);
    expect(output).toStartWith("21001 3000 3000 3000 ");
    await processorSecondsOfBuild({ source, output });
  },
  240_000,
);

test("build time is linear in the number of text elements of an array literal", async () => {
  await expectLinearBuildTime("text elements of an array literal", isSlowBuild ? 5_000 : 25_000, writeArrayOfTexts);
}, 240_000);

test("build time is linear in the number of methods of a class", async () => {
  await expectLinearBuildTime("methods of a class", isSlowBuild ? 4_000 : 30_000, writeClassWithMethods);
}, 240_000);
