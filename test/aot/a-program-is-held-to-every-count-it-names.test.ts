// run-parallel.ts asks every line of a program that bounds a count: `// STATISTIC:`, `// COUNT:` and `// COUNTER:`. None is passed over in silence:
// not one that names a counter as shell/expectations.py does, not one that is misspelled, not one that stands in another file of the program's folder.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const isCanary = Bun.spawnSync([bunExe(), "--revision"]).stdout.toString().includes("-canary");

// Only the run knows the text of the pattern, so the run time makes one pattern that the build has no record of.
const makesOnePattern = `console.log(new RegExp("^" + process.pid + "$").test(String(process.pid)));\n`;

const expected = {
  "a-counter-that-is-met.js": "pass",
  "a-counter-that-is-not-met.js": "count: RegExpsCreatedWithoutRecord = 0, but the executable counted 1",
  "a-counter-with-its-kind-that-is-not-met.js":
    "count: counter:RegExpsCreatedWithoutRecord = 0, but the executable counted 1",
  "a-limit-and-an-operation-that-are-met.js": "pass",
  "arrivals-and-branches-added-up.js": "pass",
  "a-limit-that-is-not-met.js": "count: LookupTableBases >= 1, but the executable counted 0",
  "an-operation-that-is-not-met.js": "count: operationAOTJSONSourceOpen >= 1, but the executable counted 0",
  "a-name-that-nothing-counts.js": "count: NothingCountsThis = 0, but the executable counted nothing of that name",
  "a-name-that-nothing-counts-under-todo.js":
    "count: NothingCountsThis = 0, but the executable counted nothing of that name",
  "lines-that-are-no-bounds.js":
    "read: not of the form `// STATISTIC | COUNT | COUNTER: <name> (= | >= | <=) <n>`: // COUNT: operations < 5; // COUNTER: counter:RegExpsCreatedWithoutRecord = 1; // STATISTIC: Functions",
  "a-todo-that-is-not-met.js": "pass",
  "a-todo-that-is-met.js": "count: RegExpsCreatedWithoutRecord = 1 is met: its `Todo:` goes out",
  "a-todo-beside-a-wrong-answer.js": "compare: it does not print what its last comment says",
  "a-folder/main.js": "count: RegExpsCreatedWithoutRecord = 0, but the executable counted 1",
};

test.skipIf(isWindows || !isCanary)(
  "a program is held to every count it names",
  async () => {
    using dir = tempDir("a-program-is-held-to-every-count-it-names", {
      "tsconfig.json": "{}",
      "a-counter-that-is-met.js": `// COUNTER: RegExpsCreatedWithoutRecord = 1\n${makesOnePattern}`,
      "a-counter-that-is-not-met.js": `// COUNTER: RegExpsCreatedWithoutRecord = 0\n${makesOnePattern}`,
      "a-counter-with-its-kind-that-is-not-met.js": `// COUNT: counter:RegExpsCreatedWithoutRecord = 0\n${makesOnePattern}`,
      "a-limit-and-an-operation-that-are-met.js": `// COUNTER: LookupTableBases = 0\n// COUNTER: operationAOTJSONSourceOpen = 0\n${makesOnePattern}`,
      "arrivals-and-branches-added-up.js": `// COUNT: arrivalsAndBranches >= 100\nlet odd = 0;\nfor (let i = 0; i < 100 + (process.pid & 1); i++) if (i & 1) odd++;\nconsole.log(odd);\n`,
      "a-limit-that-is-not-met.js": `// COUNTER: LookupTableBases >= 1\n${makesOnePattern}`,
      "an-operation-that-is-not-met.js": `// COUNTER: operationAOTJSONSourceOpen >= 1\n${makesOnePattern}`,
      "a-name-that-nothing-counts.js": `// COUNTER: NothingCountsThis = 0\n${makesOnePattern}`,
      "a-name-that-nothing-counts-under-todo.js": `// COUNTER: NothingCountsThis = 0 Todo: some day\n${makesOnePattern}`,
      "lines-that-are-no-bounds.js": `// COUNT: operations < 5\n// COUNTER: counter:RegExpsCreatedWithoutRecord = 1\n// STATISTIC: Functions\n${makesOnePattern}`,
      "a-todo-that-is-not-met.js": `// COUNTER: RegExpsCreatedWithoutRecord = 0 Todo: some day\n${makesOnePattern}`,
      "a-todo-that-is-met.js": `// COUNTER: RegExpsCreatedWithoutRecord = 1 Todo: some day\n${makesOnePattern}`,
      "a-todo-beside-a-wrong-answer.js": `// COUNTER: RegExpsCreatedWithoutRecord = 0 Todo: some day\n${makesOnePattern}/* Output:\nfalse\n*/\n`,
      "a-folder/main.js": `import "./another-file.js";\n`,
      "a-folder/another-file.js": `// COUNTER: RegExpsCreatedWithoutRecord = 0\n${makesOnePattern}`,
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
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line))
        .filter(({ state }) => state !== "compiling")
        .map(({ file, state, stage, message }) => [
          file.slice(root.length + 1).replaceAll("\\", "/"),
          state === "pass" ? "pass" : `${stage}: ${message}`,
        ]),
    );
    expect(verdicts).toEqual(expected);
    expect(exitCode).toBe(1);
  },
  240_000,
);

// An operation that nothing calls has no line among the counts: it counts 0, and so would a name that is misspelled. Bun holds the name of each, with a zero byte behind it.
test.skipIf(isASAN || isDebug)("an operation that a program names is one that the run time has", () => {
  const programs = join(import.meta.dir, "parallel");
  const named = new Set<string>();
  for (const file of new Bun.Glob("**/*.{js,cjs,mjs,ts,cts,mts,tsx}").scanSync(programs))
    for (const [, name] of readFileSync(join(programs, file), "utf8").matchAll(
      /^\/\/ (?:COUNT: operation:|COUNTER: )(operation\w+) /gm,
    ))
      named.add(name);
  const bun = readFileSync(bunExe());
  expect(named.size).toBeGreaterThan(0);
  expect(bun.includes("operationAOTThatNobodyHasWritten\0")).toBe(false);
  expect([...named].filter(name => !bun.includes(name + "\0"))).toEqual([]);
});
