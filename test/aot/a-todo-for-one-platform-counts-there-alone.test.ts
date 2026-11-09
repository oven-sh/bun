// run-parallel.ts: `// Todo on <process.platform> <process.arch>: <why>` is a `// Todo:` on that platform and nothing on any other.
// `// Skip on <process.platform> <process.arch>: <why>` is held to nothing that it prints on that platform, right or wrong, and is nothing on any other.
// `// Todo under ASAN: <why>` is one where Bun is built with the address sanitizer and nothing anywhere else.
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
const skipped = "skip: skipped on this platform: now one way, now the other";
const expected = {
  "wrong-here.js": "skip: todo: some day",
  "wrong-elsewhere.js": "compare: it does not print what its last comment says",
  "right-here.js": "todo: it passes: its `// Todo:` line goes out",
  "right-elsewhere.js": "pass",
  "the-line-for-here-goes-first.js": "skip: todo: another day",
  "skipped-here-and-right.js": `${skipped} | in this run the executable printed what the reference printed`,
  "skipped-here-and-wrong.js": `${skipped} | in this run the reference printed "false\\n" and the executable "true\\n"`,
  "skipped-elsewhere-and-wrong.js": "compare: it does not print what its last comment says",
  "wrong-under-asan.js": isASAN ? "skip: todo: some day" : "compare: it does not print what its last comment says",
  "right-under-asan.js": isASAN ? "todo: it passes: its `// Todo:` line goes out" : "pass",
};

test("a todo for one platform counts there alone", async () => {
  using dir = tempDir("a-todo-for-one-platform-counts-there-alone", {
    "tsconfig.json": "{}",
    "wrong-here.js": `// Todo on ${here}: some day\n${wrong}`,
    "wrong-elsewhere.js": `// Todo on plan9 mips: some day\n${wrong}`,
    "right-here.js": `// Todo on ${here}: some day\n${right}`,
    "right-elsewhere.js": `// Todo on plan9 mips: some day\n${right}`,
    "the-line-for-here-goes-first.js": `// Todo: some day\n// Todo on ${here}: another day\n${wrong}`,
    "skipped-here-and-right.js": `// Skip on ${here}: now one way, now the other\n${right}`,
    "skipped-here-and-wrong.js": `// Skip on ${here}: now one way, now the other\n${wrong}`,
    "skipped-elsewhere-and-wrong.js": `// Skip on plan9 mips: now one way, now the other\n${wrong}`,
    "wrong-under-asan.js": `// Todo under ASAN: some day\n${wrong}`,
    "right-under-asan.js": `// Todo under ASAN: some day\n${right}`,
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
