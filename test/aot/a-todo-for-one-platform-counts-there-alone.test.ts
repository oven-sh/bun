// run-parallel.ts: `// Todo on <process.platform> <process.arch>: <why>` is a `// Todo:` on that platform and nothing on any other.
// `// Todo under ASAN: <why>` is one where Bun is built with the address sanitizer and nothing anywhere else.
// Each says in front of its reason what differs, and stands for that alone: a program that fails otherwise fails, and so does one whose line does not say it.
// A bound may end with ` Todo: <why>`, ` Todo on <process.platform>: <why>` or ` Todo on <process.platform> <process.arch>: <why>`: it is asked all the same, fails once it is met, and the line of its file says what was counted,
// so that tools/goals-that-grew.ts can tell a goal that moves further off from one that stands still.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const here = `${process.platform} ${process.arch}`;
const right = "console.log(true);\n/* Output:\ntrue\n*/\n";
const wrong = "console.log(true);\n/* Output:\nfalse\n*/\n";
const oneForTheOther = '"true" | "false"';
const notMeant = "its `// Todo` does not stand for that";
const compiled = 'const compiled = Bun.main.startsWith("/$bunfs/") || Bun.main.includes("~BUN");\n';
const expected = {
  "wrong-here.js": `skip: todo: ${oneForTheOther}: some day`,
  "wrong-elsewhere.js": "compare: it does not print what its last comment says",
  "right-here.js": "todo: it passes: its `// Todo:` line goes out",
  "right-elsewhere.js": "pass",
  "the-line-for-here-goes-first.js": `skip: todo: ${oneForTheOther}: another day`,
  "wrong-under-asan.js": isASAN
    ? `skip: todo: ${oneForTheOther}: some day`
    : "compare: it does not print what its last comment says",
  "right-under-asan.js": isASAN ? "todo: it passes: its `// Todo:` line goes out" : "pass",
  "wrong-in-another-line-too.js": `compare: it does not print what its last comment says: ${notMeant}`,
  "wrong-in-other-words.js": `compare: it does not print what its last comment says: ${notMeant}`,
  "ends-otherwise.js": `compare: it does not print what its last comment says: ${notMeant}`,
  "its-build-says-otherwise.js": `compile: the build prints 0 x nothing like it, not 1 x: ${notMeant}`,
  "wrong-where-it-is-said-to-grow.js": `compare: it does not print what its last comment says: ${notMeant}`,
  "not-as-plain-bun.js": `skip: todo: ${oneForTheOther}: some day`,
  "not-as-plain-bun-in-another-line-too.js": `compare: it does not exit and print as plain Bun does: ${notMeant}`,
  "does-not-say-what-differs.js":
    'read: not of the form `// Todo..: it grows: <why>`, `// Todo..: "<a word>" | "<the word for it>": <why>` or `// Todo: only frames (..): <why>`: // Todo: some day',
  "does-not-say-what-differs-elsewhere.js":
    'read: not of the form `// Todo..: it grows: <why>`, `// Todo..: "<a word>" | "<the word for it>": <why>` or `// Todo: only frames (..): <why>`: // Todo on plan9 mips: some day',
};

test("a todo for one platform counts there alone", async () => {
  using dir = tempDir("a-todo-for-one-platform-counts-there-alone", {
    "tsconfig.json": "{}",
    "wrong-here.js": `// Todo on ${here}: ${oneForTheOther}: some day\n${wrong}`,
    "wrong-elsewhere.js": `// Todo on plan9 mips: ${oneForTheOther}: some day\n${wrong}`,
    "right-here.js": `// Todo on ${here}: ${oneForTheOther}: some day\n${right}`,
    "right-elsewhere.js": `// Todo on plan9 mips: ${oneForTheOther}: some day\n${right}`,
    "the-line-for-here-goes-first.js": `// Todo: ${oneForTheOther}: some day\n// Todo on ${here}: ${oneForTheOther}: another day\n${wrong}`,
    "wrong-under-asan.js": `// Todo under ASAN: ${oneForTheOther}: some day\n${wrong}`,
    "right-under-asan.js": `// Todo under ASAN: ${oneForTheOther}: some day\n${right}`,
    "wrong-in-another-line-too.js": `// Todo: ${oneForTheOther}: some day\nconsole.log(true);\nconsole.log(1);\n/* Output:\nfalse\n2\n*/\n`,
    "wrong-in-other-words.js": `// Todo: "collected" | "KEPT": some day\n${wrong}`,
    "ends-otherwise.js": `// Todo: ${oneForTheOther}: some day\nconsole.log(true);\nprocess.exit(3);\n/* Output:\nfalse\n*/\n`,
    "its-build-says-otherwise.js": `// Todo: ${oneForTheOther}: some day\n// Build prints: 1 x nothing like it\n${wrong}`,
    "wrong-where-it-is-said-to-grow.js": `// Todo: it grows: some day\n${wrong}`,
    "not-as-plain-bun.js": `// Todo: ${oneForTheOther}: some day\n${compiled}console.log("it is", compiled);\nconsole.log(1);\n`,
    "not-as-plain-bun-in-another-line-too.js": `// Todo: ${oneForTheOther}: some day\n${compiled}console.log("it is", compiled);\nconsole.log(compiled ? 1 : 2);\n`,
    "does-not-say-what-differs.js": `// Todo: some day\n${wrong}`,
    "does-not-say-what-differs-elsewhere.js": `// Todo on plan9 mips: some day\n${right}`,
  });
  const root = String(dir);
  const files = Object.keys(expected).map(name => join(root, name));
  const { stdout, exitCode } = await run(
    [bunExe(), join(import.meta.dir, "run-parallel.ts"), `--root=${root}`, "--jobs=4", "--no-erased", ...files],
    root,
    bunEnv,
  );
  const verdicts = Object.fromEntries(
    stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(({ state }) => state !== "compiling")
      .map(({ file, state, stage, message }) => [
        file.slice(root.length + 1).replaceAll("\\", "/"),
        state === "pass" ? "pass" : `${state === "skip" ? "skip" : stage}: ${message}`,
      ]),
  );
  expect(verdicts).toEqual(expected);
  expect(exitCode).toBe(1);
}, 120_000);

test("a bound that is not met yet says what was counted", async () => {
  const bound = "ImageFunctionsEmitted <= 0";
  using dir = tempDir("a-bound-that-is-not-met-yet-says-what-was-counted", {
    "tsconfig.json": "{}",
    "parallel/not-met.js": `// STATISTIC: ${bound} Todo: some day\n${right}`,
    "parallel/not-met-here.js": `// STATISTIC: ${bound} Todo on ${process.platform}: some day\n${right}`,
    "parallel/not-met-elsewhere.js": `// STATISTIC: ${bound} Todo on plan9: some day\n${right}`,
    "parallel/not-met-on-this-processor.js": `// STATISTIC: ${bound} Todo on ${process.platform} ${process.arch}: some day\n${right}`,
    "parallel/not-met-on-another-processor.js": `// STATISTIC: ${bound} Todo on ${process.platform} mips: some day\n${right}`,
    "parallel/met.js": `// STATISTIC: ImageFunctionsEmitted >= 1 Todo: some day\n${right}`,
    "parallel/held.js": `// STATISTIC: ImageFunctionsEmitted >= 1\n${right}`,
    "parallel/held-on-this-processor.js": `// STATISTIC on ${process.arch}: ImageFunctionsEmitted >= 1\n${right}`,
    "parallel/broken-on-this-processor.js": `// STATISTIC on ${process.arch}: ${bound}\n${right}`,
    "parallel/broken-on-another-processor.js": `// STATISTIC on ${process.arch === "x64" ? "arm64" : "x64"}: ${bound}\n${right}`,
    "parallel/on-no-processor.js": `// STATISTIC on mips: ${bound}\n${right}`,
  });
  const root = join(String(dir), "parallel");
  const files = [
    "not-met.js",
    "not-met-here.js",
    "not-met-elsewhere.js",
    "not-met-on-this-processor.js",
    "not-met-on-another-processor.js",
    "met.js",
    "held.js",
    "held-on-this-processor.js",
    "broken-on-this-processor.js",
    "broken-on-another-processor.js",
    "on-no-processor.js",
  ];
  const { stdout, exitCode } = await run(
    [
      bunExe(),
      join(import.meta.dir, "run-parallel.ts"),
      `--root=${root}`,
      "--jobs=4",
      "--no-erased",
      ...files.map(name => join(root, name)),
    ],
    root,
    bunEnv,
  );
  const lines = Object.fromEntries(
    stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(({ state }) => state !== "compiling")
      .map(({ file, state, stage, message, goalsNotMet }) => [
        file.slice(root.length + 1),
        { verdict: state === "pass" ? "pass" : `${stage}: ${message}`, goalsNotMet },
      ]),
  );
  const counted: number = lines["not-met.js"]?.goalsNotMet?.[bound];
  expect(counted).toBeGreaterThan(0);
  expect(lines).toEqual({
    "not-met.js": { verdict: "pass", goalsNotMet: { [bound]: counted } },
    "not-met-here.js": { verdict: "pass", goalsNotMet: { [bound]: counted } },
    "not-met-elsewhere.js": { verdict: `compile: ${bound}, but the build counted ${counted}`, goalsNotMet: undefined },
    "not-met-on-this-processor.js": { verdict: "pass", goalsNotMet: { [bound]: counted } },
    "not-met-on-another-processor.js": {
      verdict: `compile: ${bound}, but the build counted ${counted}`,
      goalsNotMet: undefined,
    },
    "met.js": {
      verdict: "compile: ImageFunctionsEmitted >= 1 is met: its `Todo:` goes out",
      goalsNotMet: { "ImageFunctionsEmitted >= 1": counted },
    },
    "held.js": { verdict: "pass", goalsNotMet: undefined },
    "held-on-this-processor.js": { verdict: "pass", goalsNotMet: undefined },
    "broken-on-this-processor.js": {
      verdict: `compile: ${bound}, but the build counted ${counted}`,
      goalsNotMet: undefined,
    },
    "broken-on-another-processor.js": { verdict: "pass", goalsNotMet: undefined },
    "on-no-processor.js": {
      verdict: `read: not of the form \`// STATISTIC | STATISTIC on x64 | COUNT | COUNTER | COUNTER in every build: <name> (= | >= | <=) <n>\`: // STATISTIC on mips: ${bound}`,
      goalsNotMet: undefined,
    },
  });
  expect(exitCode).toBe(1);

  const [before, after] = [join(String(dir), "before.txt"), join(String(dir), "after.txt")];
  writeFileSync(before, stdout);
  writeFileSync(after, stdout.replaceAll(`"${bound}":${counted}`, `"${bound}":${counted * 2}`));
  const compare = (one: string, other: string, ...more: string[]) =>
    run([bunExe(), join(import.meta.dir, "tools", "goals-that-grew.ts"), one, other, ...more], root, bunEnv);
  expect(await compare(before, after, "--over=2")).toMatchObject({
    stdout:
      `FURTHER not-met-here.js: ${bound}: ${counted} > ${counted * 2} (+${counted}, 100.0%)\n` +
      `FURTHER not-met-on-this-processor.js: ${bound}: ${counted} > ${counted * 2} (+${counted}, 100.0%)\n` +
      `FURTHER not-met.js: ${bound}: ${counted} > ${counted * 2} (+${counted}, 100.0%)\n` +
      "4 goals not met: 3 further from their bounds, 3 of them by more than 2% . 0 nearer . 1 as they were\n",
    exitCode: 1,
  });
  expect(await compare(before, after, "--over=100")).toMatchObject({ exitCode: 0 });
  expect(await compare(after, before)).toMatchObject({
    stdout: "4 goals not met: 0 further from their bounds, 0 of them by more than 0% . 3 nearer . 1 as they were\n",
    exitCode: 0,
  });
  expect(await compare(before, before)).toMatchObject({
    stdout: "4 goals not met: 0 further from their bounds, 0 of them by more than 0% . 0 nearer . 4 as they were\n",
    exitCode: 0,
  });
}, 120_000);
