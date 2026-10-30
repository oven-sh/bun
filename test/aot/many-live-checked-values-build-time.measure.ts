import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { measureUntilWithinBounds } from "./harness/measure-again";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;

type Program = { source: string; output: string };

const rounds = 50;
const modulus = 1000003;

function sumOf(count: number) {
  let total = 0;
  for (let n = 1; n <= count; n++) total = (total * 31 + n) % modulus;
  return total;
}

function outputOf(resultOfOneCall: number) {
  let all = 0;
  for (let round = 0; round < rounds; round++) all = (all + resultOfOneCall) % modulus;
  return `${all}\n`;
}

const declarations = `interface Rec { n: number }
function sum(all: Rec[]): number { let total = 0; for (const r of all) total = (total * 31 + r.n) % ${modulus}; return total; }`;

const parseRows = (count: number) =>
  `const rows = JSON.parse(JSON.stringify(Array.from({ length: ${count} }, (_, i) => ({ n: i + 1 })))) as Rec[];`;

// The type of each element is only declared, so each read is checked, and what has been read goes into one array at the end.
function writeReadsOfParsedElements(count: number): Program {
  const names = Array.from({ length: count }, (_, index) => `a${index}`);
  return {
    source: [
      declarations,
      "function keep(rows: Rec[]): number {",
      ...names.map((name, index) => `  const ${name} = rows[${index}];`),
      `  return sum([${names.join(", ")}]);`,
      "}",
      parseRows(count),
      "let all = 0;",
      `for (let round = 0; round < ${rounds}; round++) all = (all + keep(rows)) % ${modulus};`,
      "console.log(all);",
    ].join("\n"),
    output: outputOf(sumOf(count)),
  };
}

function writeReadsAliveOverAwait(count: number): Program {
  const names = Array.from({ length: count }, (_, index) => `a${index}`);
  return {
    source: [
      declarations,
      "async function tick(): Promise<void> { await null; }",
      "async function fail(value: unknown): Promise<never> { await tick(); throw value; }",
      "async function keep(rows: Rec[]): Promise<number> {",
      ...names.map((name, index) => `  const ${name} = rows[${index}];`),
      "  let caught = 0;",
      "  try { await fail(rows[0]); } catch (error) { caught = (error as Rec).n; }",
      `  return sum([${names.join(", ")}]) + caught;`,
      "}",
      parseRows(count),
      "let all = 0;",
      `for (let round = 0; round < ${rounds}; round++) all = (all + (await keep(rows))) % ${modulus};`,
      "console.log(all);",
    ].join("\n"),
    output: outputOf(sumOf(count) + 1),
  };
}

async function processorSecondsOfBuild(program: Program) {
  using dir = tempDir("aot-many-live-checked-values", { "main.ts": program.source });
  await using built = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", "./main"],
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

test("build time is linear in the number of checked values that stay alive to the end of a function", async () => {
  await expectLinearBuildTime("checked values alive to the end", isSlowBuild ? 100 : 400, writeReadsOfParsedElements);
}, 240_000);

test("build time is linear in the number of checked values that stay alive over an await", async () => {
  await expectLinearBuildTime("checked values alive over an await", isSlowBuild ? 100 : 400, writeReadsAliveOverAwait);
}, 240_000);
