// Runs alone: it judges by a clock.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
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

async function buildsAndPrints(program: Program) {
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
}

// Each builds in a few seconds. Where a step of the build took the square of the length, 70,000 members took over four minutes.
test.concurrent(
  "an object literal of very many members builds",
  () => buildsAndPrints(writeObjectLiteral(isSlowBuild ? 20_000 : 70_000)),
  60_000,
);

test.concurrent(
  "a function with two array literals of very many elements builds",
  () => buildsAndPrints(writeTwoArrayLiterals(isSlowBuild ? 20_000 : 80_000)),
  60_000,
);
