import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const numberOfNames = 48;
const numbers = Array.from({ length: numberOfNames }, (_, index) => index);
const lines = (line: (number: number) => string) => numbers.map(line).join("\n");
const sumOfNumbers = numbers.reduce((sum, number) => sum + number, 0);

// Each of these gives one object its names by code that runs once.
const filledOnce: Record<string, string> = {
  "a-prototype-object.cjs": `
function Made(base) { this.base = base; }
${lines(number => `Made.prototype.method${number} = function () { return this.base + ${number}; };`)}
const made = new Made(0);
let sum = 0;
${lines(number => `sum += made.method${number}();`)}
console.log(sum);
`,
  "a-function.cjs": `
function holder() {}
${lines(number => `holder.member${number} = ${number};`)}
let sum = 0;
${lines(number => `sum += holder.member${number};`)}
console.log(sum);
`,
  "definitions-on-a-function.cjs": `
function holder() {}
${lines(number => `Object.defineProperty(holder, "member${number}", { enumerable: true, get: function () { return ${number}; } });`)}
let sum = 0;
${lines(number => `sum += holder.member${number};`)}
console.log(sum);
`,
  "what-a-built-in-made.cjs": `
const holder = JSON.parse("{}");
${lines(number => `holder.member${number} = ${number};`)}
let sum = 0;
for (const name in holder) sum += holder[name];
console.log(sum);
`,
};

// The names come again, in the same order, for object after object.
const rounds = 500;
const filledAgainAndAgain = `
function fill(object, round) {
${lines(number => `  object.member${number} = round + ${number};`)}
  return object;
}
let sum = 0;
for (let round = 0; round < ${rounds}; round++) sum += fill(JSON.parse("{}"), round).member${numberOfNames - 1} - round;
console.log(sum);
`;

/** What the program prints, and how many Structures were made while its own code ran, by what made them. */
async function answerAndStructures(files: Record<string, string>, entry: string) {
  using dir = tempDir("aot-an-object-that-is-filled-once", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], String(dir));
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const counts = join(String(dir), "counts.txt");
  const ran = await run([executable], String(dir), { ...bunEnv, [runtimeEnvironment.countsPath]: counts });
  expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  let forOneMoreProperty = 0;
  let dictionaries = 0;
  for (const line of readFileSync(counts, "utf8").split("\n")) {
    const [kind, , place, what, times] = line.split(" ");
    if (kind !== "made" || !place.startsWith(entry + ":")) continue;
    if (what.startsWith("Structure:a_property_more")) forOneMoreProperty += Number(times);
    if (what.startsWith("Structure:a_dictionary")) dictionaries += Number(times);
  }
  return { answer: Number(ran.stdout), forOneMoreProperty, dictionaries };
}

test.each(Object.keys(filledOnce))(
  "the names that one object is given once are kept in one table: %s",
  async entry => {
    const { answer, forOneMoreProperty, dictionaries } = await answerAndStructures(filledOnce, entry);
    expect(answer).toBe(sumOfNumbers);
    expect(forOneMoreProperty).toBeLessThan(numberOfNames / 4);
    expect(dictionaries).toBeLessThan(4);
  },
  240_000,
);

test("objects that are given the same names again share their Structures", async () => {
  const { answer, forOneMoreProperty, dictionaries } = await answerAndStructures(
    { "again.cjs": filledAgainAndAgain },
    "again.cjs",
  );
  expect(answer).toBe(rounds * (numberOfNames - 1));
  expect(forOneMoreProperty).toBeLessThan(2 * numberOfNames);
  expect(dictionaries).toBeLessThan(4);
}, 240_000);
