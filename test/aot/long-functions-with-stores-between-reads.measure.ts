import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { expectLinearInstructionCount } from "./long-functions-instructions";
import { indexesUpTo, mix, type Program } from "./long-functions-programs";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;

// Every local is loaded from one of two arrays of numbers, a variable of the module is written behind each load, and then every local is used once.
function writeLocalsLoadedBetweenStores(localCount: number): Program {
  const indexes = indexesUpTo(localCount);
  const valueAt = (index: number) => (index % 3 ? index + 0.25 : index * 7);
  const storedByOneCall = indexes.reduce((sum, index) => sum + index, 0);
  return {
    source: [
      "const fractions = [], integers = [];",
      `for (let index = 0; index < ${localCount}; index++) { fractions.push(index + 0.25); integers.push(index * 7); }`,
      "let stored = 0;",
      "function mix(sum, value) { return (sum * 33 + value) % 1000000007; }",
      "function run(fractions, integers, first) {",
      "let sum = first;",
      ...indexes.map(
        index => `const local${index} = ${index % 3 ? "fractions" : "integers"}[${index}]; stored += ${index};`,
      ),
      ...indexes.map(index => `sum = mix(sum, local${index} * 4);`),
      "return sum;",
      "}",
      "console.log(run(fractions, integers, 1), run(fractions, integers, 2), stored);",
    ].join("\n"),
    output: `${[1, 2].map(first => indexes.reduce((sum, index) => mix(sum, valueAt(index) * 4), first)).join(" ")} ${2 * storedByOneCall}\n`,
  };
}

// The arrays are cut shorter between the calls, so in each call the loads find nothing from another place on.
function writeLocalsLoadedFromArraysThatShrink(localCount: number): string {
  const indexes = indexesUpTo(localCount);
  return [
    "const fractions = [], integers = [];",
    `for (let index = 0; index < ${localCount}; index++) { fractions.push(index + 0.25); integers.push(index * 7); }`,
    "let stored = 0;",
    "function mix(sum, value) { return (sum * 33 + value) % 1000000007; }",
    "function run(fractions, integers) {",
    "let sum = 1;",
    ...indexes.map(
      index => `const local${index} = ${index % 3 ? "fractions" : "integers"}[${index}]; stored += ${index};`,
    ),
    ...indexes.map(index => `sum = mix(sum, local${index} * 4 || ${(index % 13) + 1});`),
    "return sum + stored;",
    "}",
    "console.log(run(fractions, integers));",
    ...[0.97, 0.8, 0.55, 0.5, 0.3, 0.1, 0.02].flatMap(part => [
      `fractions.length = ${Math.floor(localCount * part)}; console.log(run(fractions, integers));`,
      `integers.length = ${Math.floor(localCount * part) - 1}; console.log(run(fractions, integers));`,
    ]),
  ].join("\n");
}

async function outputOf(cmd: string[], cwd: string) {
  await using ran = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [output, errors, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { output, errors, exitCode };
}

async function codeBytesOfFunction(program: Program, name: string) {
  using dir = tempDir("aot-long-functions-stores-between-reads", { "main.js": program.source });
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
  "the instructions of a build are nearly linear in the number of locals loaded between stores",
  async () => {
    await expectLinearInstructionCount(100, writeLocalsLoadedBetweenStores, 5.5);
  },
  240_000,
);

test.skipIf(isSlowBuild)(
  "the code of a function is linear in the number of locals loaded between stores",
  async () => {
    const [withFew, withMany] = await Promise.all(
      [100, 400].map(localCount => codeBytesOfFunction(writeLocalsLoadedBetweenStores(localCount), "run")),
    );
    expect(withFew).toBeGreaterThan(0);
    expect(withMany / withFew).toBeLessThan(5);
  },
  240_000,
);

test.skipIf(isSlowBuild)(
  "loads between stores that find nothing from some place on give what they give without --aot",
  async () => {
    using dir = tempDir("aot-long-functions-arrays-that-shrink", {
      "main.js": writeLocalsLoadedFromArraysThatShrink(200),
    });
    const cwd = String(dir);
    const built = await outputOf([bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", "./main"], cwd);
    expect(built).toMatchObject({ exitCode: 0 });
    const expected = await outputOf([bunExe(), "./main.js"], cwd);
    expect(new Set(expected.output.trim().split("\n")).size).toBe(15);
    expect(await outputOf(["./main"], cwd)).toEqual(expected);
  },
  240_000,
);
