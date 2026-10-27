import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { measureUntilWithinBounds } from "./harness/measure-again";
import { test } from "./supported";

const isSlowBuild = isDebug || isASAN;

const hashTexts = `function hashTexts(texts) {
  let hash = 0;
  for (const text of texts) hash = (Math.imul(hash, 31) + text.length + text.charCodeAt(text.length - 1)) | 0;
  return hash;
}`;

type Program = { source: string; output: string };

function hashOf(texts: string[]) {
  let hash = 0;
  for (const text of texts) hash = (Math.imul(hash, 31) + text.length + text.charCodeAt(text.length - 1)) | 0;
  return hash;
}

function writeObjectLiteral(memberCount: number): Program {
  const texts = Array.from({ length: memberCount }, (_, index) => `Sentence number ${index} of a long list.`);
  const members = texts.map((text, index) => `"page.title.k${index}": ${JSON.stringify(text)}`);
  return {
    source: [
      hashTexts,
      `const table = { ${members.join(", ")} };`,
      "console.log(Object.keys(table).length, hashTexts(Object.keys(table)), hashTexts(Object.values(table)));",
    ].join("\n"),
    output: `${memberCount} ${hashOf(texts.map((_, index) => `page.title.k${index}`))} ${hashOf(texts)}\n`,
  };
}

// One element of each array is known only when the program runs, and the second array is made when the first is finished.
function writeTwoArrayLiterals(elementCount: number): Program {
  const textsOf = (name: string) => [
    "first",
    ...Array.from({ length: elementCount / 2 }, (_, index) => `${name} sentence number ${index}`),
  ];
  const literalOf = (texts: string[]) => {
    const constants = texts.slice(1).map(text => JSON.stringify(text));
    return `[Date.now() > 0 ? "first" : "never", ${constants.join(", ")}]`;
  };
  const [early, late] = [textsOf("early"), textsOf("late")];
  return {
    source: [
      hashTexts,
      `const early = ${literalOf(early)};`,
      "console.log(early.length, hashTexts(early));",
      `const late = ${literalOf(late)};`,
      "console.log(late.length, hashTexts(late), hashTexts(early));",
    ].join("\n"),
    output: `${early.length} ${hashOf(early)}\n${late.length} ${hashOf(late)} ${hashOf(early)}\n`,
  };
}

async function processorSecondsOfBuild(program: Program) {
  using dir = tempDir("aot-long-literals", { "main.js": program.source });
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

test("build time is linear in the number of members of an object literal", async () => {
  await expectLinearBuildTime("members of an object literal", isSlowBuild ? 5_000 : 35_000, writeObjectLiteral);
}, 240_000);

test("build time is linear in the number of elements of the array literals of a function", async () => {
  await expectLinearBuildTime("elements of two array literals", isSlowBuild ? 5_000 : 20_000, writeTwoArrayLiterals);
}, 240_000);
