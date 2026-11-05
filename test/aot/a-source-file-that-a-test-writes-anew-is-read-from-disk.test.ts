import { expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` reads a file when something first loads it. a.test.js writes state.js anew, and b.test.js, which under --isolate has a realm of
// its own, imports it: it gets the new text. The compiled state.js is the text of the build. The run takes files out of require.cache, so
// the build has compiled state.js as a file that may be read again from disk, and the run looks at the file before it first loads it.
const first = `export let count = 0;\nexport function bump() { return ++count; }\n`;
const newText = `export let count = 100;\nexport function bump() { return count += 10; }\nexport const extra = "new";\n`;

// The files of a case begin with its name, and so does a line that it prints. Its test files stand in the folder of the project
// itself: there `bun test` takes the test files in the order of their names, so a.test.js of a case runs before its b.test.js. It
// takes those of a folder below in the order in which the file system lists them.
const filesOf = (name: string, newText: string, throughHelper = false): Record<string, string> => ({
  [`${name}-state.js`]: first,
  [`${name}-helper.js`]: `import { bump, count } from "./${name}-state.js"; export const seen = () => [count, bump(), count].join();`,
  [`${name}-a.test.js`]: `
    import { test } from "bun:test";
    import { writeFileSync } from "node:fs";
    test("a", () => {
      const path = require.resolve("./${name}-state.js");
      console.log("${name} a", require(path).bump());
      writeFileSync(path, ${JSON.stringify(newText)});
      delete require.cache[path];
    });`,
  [`${name}-b.test.js`]: throughHelper
    ? `
    import { test } from "bun:test";
    import { seen } from "./${name}-helper.js";
    test("b", () => { console.log("${name} b", seen()); });`
    : `
    import { test } from "bun:test";
    import { bump, count } from "./${name}-state.js";
    import * as all from "./${name}-state.js";
    test("b", () => { console.log("${name} b", count, bump(), count, Object.keys(all).join()); });`,
});
type Project = { cases: string[]; files: Record<string, string> };
const packageJson = `{ "name": "p", "type": "module" }`;

// A build is what costs, so the two cases that pass are one project, and a way of running it builds both once. Neither says
// anything of the files of the other: a.test.js takes the state.js of its case out, under a key that the build follows to that
// file, and writes no other. So the build holds of each case what it holds where the case is a project of its own.
const passing: Project = {
  cases: ["direct", "through"],
  files: { "package.json": packageJson, ...filesOf("direct", newText), ...filesOf("through", newText, true) },
};
// This case fails its run. Beside it a run exits with 1 whatever the other cases leave, so it keeps a project of its own.
const failing: Project = {
  cases: ["lacks"],
  files: { "package.json": packageJson, ...filesOf("lacks", `export let count = 100;\n`) },
};

type Said = {
  /** Of each case: the lines that its test files print, and what the runner says under their names. */
  cases: Map<string, { printed: string[]; reported: string[] }>;
  /** What no case answers for: the other lines, and the exit code. */
  rest: { stdout: string[]; stderr: string[]; exitCode: number };
};

/** `bun test` in a folder: every line that it prints, without the times and with <dir> for the folder. */
async function runTests(
  folder: string,
  flags: string[],
  environment: Record<string, string> = {},
  cases: string[] = [],
) {
  // With BUN_JSC_logAOTPhaseTimes a run logs its steps on stderr, and the tests state every line of a run.
  const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: undefined, ...environment };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  const lines = (text: string) =>
    normalizeBunSnapshot(text, folder)
      .split("\n")
      .filter(line => line.trim());
  const said: Said = {
    cases: new Map(cases.map(name => [name, { printed: [], reported: [] }])),
    rest: { stdout: [], stderr: [], exitCode },
  };
  for (const line of lines(stdout)) (said.cases.get(line.split(" ")[0])?.printed ?? said.rest.stdout).push(line);
  // The runner names a test file above what it says of it. The counts of the run stand behind the last file.
  let reported: string[] | undefined;
  for (const line of lines(stderr)) {
    const [, name] = line.match(/^(\w+)-\w+\.test\.js:$/) ?? [];
    if (name) reported = said.cases.get(name)?.reported;
    else if (/^ *\d+ pass$/.test(line)) reported = undefined;
    (reported ?? said.rest.stderr).push(line);
  }
  return said;
}

/** For the environment of a compiled run: each of its processes writes its counts into the folder as it ends. */
const countsPath = (folder: string) => ({ [runtimeEnvironment.countsPath]: join(folder, "counts-%p") });
/** How many files each process of the run compared with the disk. */
const comparedWithDisk = (folder: string) =>
  readdirSync(folder)
    .filter(name => name.startsWith("counts-"))
    .flatMap(name => readFileSync(join(folder, name), "utf8").split("\n"))
    .filter(line => line.endsWith("\tcounter:FilesComparedWithDisk"))
    .map(line => Number(line.split("\t")[0]));

// With a word that begins with `TestRun` a compiled run says how it is built, for so many test files. A Bun that loads one program a
// realm has no layers, and says that.
const noLayers = "this Bun loads one program a realm";
const asOneProgram = (testFiles: number) =>
  new RegExp(`^AOT test run \\| one program(: ${noLayers})? \\| test files ${testFiles}$`);
const overTwoLayers = (testFiles: number) =>
  new RegExp(
    `^AOT test run \\| (layers 2|programs without layers: ${noLayers}) \\| test files ${testFiles} \\| to a program 1( \\||$)`,
  );

const ways: [string[], string][] = [
  [[], ""],
  [["--isolate"], "TestRunLayers:0"],
  [["--isolate"], "TestRunLayers:2,TestRunPartFiles:1"],
];

/** Plain `bun test` and then `bun test --aot` in a copy of a project. */
async function runBoth({ cases, files }: Project, flags: string[], words: string) {
  using dir = tempDir("a-source-file-written-anew", files);
  const folder = String(dir);
  const plain = await runTests(folder, flags, {}, cases);
  // The plain run has left the new texts.
  for (const name of cases) writeFileSync(join(folder, `${name}-state.js`), first);
  // The word changes nothing: with it a run that has no other word says how it is built.
  const environment = { BUN_DEBUG_TEST_AOT_WORDS: words || "TestRunSaysItsForm", ...countsPath(folder) };
  const compiled = await runTests(folder, ["--aot", ...flags], environment, cases);
  const compared = comparedWithDisk(folder).reduce((sum, count) => sum + count, 0);
  return { plain, compiled: { ...compiled, comparedWithDisk: compared } };
}

type Run = { hasEnded: boolean; said: ReturnType<typeof runBoth> };
const runs = new Map<string, Run>();
const keyOf = ({ cases }: Project, flags: string[], words: string) => JSON.stringify([cases, flags, words]);
/** A project runs once in each way, however many tests ask. The first test that asks waits for the build. */
const ran = (project: Project, flags: string[], words: string) =>
  runs.getOrInsertComputed(keyOf(project, flags, words), () => {
    const run: Run = {
      hasEnded: false,
      said: runBoth(project, flags, words).finally(() => void (run.hasEnded = true)),
    };
    return run;
  }).said;
/**
 * The same for the test of a case. Such a test runs behind the tests of the runs. A run that has not ended by then hangs: its own
 * test has waited for it to its limit, and no other test waits for it again.
 */
function ended(project: Project, flags: string[], words: string) {
  if (runs.get(keyOf(project, flags, words))?.hasEnded === false)
    throw new Error("the run has not ended: its own test has waited for it to its limit");
  return ran(project, flags, words);
}

/**
 * What no case answers for: the counts of the run and its exit code. The compiled run also says how it is built, and has compared
 * so many files with the disk.
 */
async function expectRun(
  project: Project,
  flags: string[],
  words: string,
  { counts, exitCode, compared }: { counts: string[]; exitCode: number; compared: number },
) {
  const { plain, compiled } = await ran(project, flags, words);
  const rest = { stdout: ["bun test <version> (<revision>)"], stderr: counts, exitCode };
  expect(plain.rest).toEqual(rest);
  const testFiles = 2 * project.cases.length;
  const built = words.includes("TestRunLayers:2") ? overTwoLayers(testFiles) : asOneProgram(testFiles);
  expect({ ...compiled.rest, comparedWithDisk: compiled.comparedWithDisk }).toEqual({
    ...rest,
    stderr: [expect.stringMatching(built), ...counts],
    comparedWithDisk: compared,
  });
}

// Each run is a test of its own, so `bun test --max-concurrency` says how many of them are built at once. The tests of the cases
// stand at the end of the file: they run one at a time behind these, and read the runs that have ended here.
test.concurrent.each(ways)(
  "the run of the two cases that pass: %j %s",
  async (flags, words) => {
    await expectRun(passing, flags, words, {
      counts: [" 4 pass", " 0 fail", "Ran 4 tests across 4 files."],
      exitCode: 0,
      // A file is looked at once in a realm, before it first loads there: state.js of each case, and the helper.js that a
      // b.test.js imports. Under --isolate a.test.js has a realm of its own, and loads state.js there too.
      compared: flags.includes("--isolate") ? 5 : 3,
    });
  },
  240_000,
);

test.concurrent.each(ways)(
  "the run of the case that fails: %j %s",
  async (flags, words) => {
    await expectRun(failing, flags, words, {
      // b.test.js cannot load. The runner counts that as a test that fails and as an error.
      counts: [" 1 pass", " 1 fail", " 1 error", "Ran 2 tests across 2 files."],
      exitCode: 1,
      compared: flags.includes("--isolate") ? 2 : 1,
    });
  },
  240_000,
);

// The price, by count: a file is looked at on disk once in a realm, before it first loads there, and only where the run may read it
// again from disk at all. A run that takes nothing out of require.cache looks at no file.
test.concurrent.each([
  ["takes a file out of require.cache", true],
  ["takes nothing out", false],
])(
  "a run that %s",
  async (_, takesFilesOut) => {
    const moduleCount = 12;
    const modules = Object.fromEntries(
      Array.from({ length: moduleCount }, (_, index) => [
        `src/m${index}.js`,
        (index + 1 < moduleCount
          ? `import { v${index + 1} } from "./m${index + 1}.js";\n`
          : `const v${moduleCount} = 0;\n`) + `export const v${index} = ${index} + v${index + 1};\n`,
      ]),
    );
    const testFile = (name: string, more = "") =>
      `import { expect, test } from "bun:test";\nimport { v0 } from "./src/m0.js";\ntest("${name}", () => { expect(v0).toBe(66); ${more} });\n`;
    using dir = tempDir("a-source-file-written-anew-count", {
      "package.json": `{ "type": "module" }`,
      ...modules,
      "a.test.js": testFile("a"),
      "b.test.js": testFile(
        "b",
        takesFilesOut ? `delete require.cache[require.resolve("./" + ["src", "m3.js"].join("/"))];` : "",
      ),
    });
    const cwd = String(dir);
    const environment = { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0", ...countsPath(cwd) };
    const { rest } = await runTests(cwd, ["--aot", "--isolate"], environment);
    expect(rest).toEqual({
      stdout: ["bun test <version> (<revision>)"],
      stderr: [
        expect.stringMatching(asOneProgram(2)),
        "a.test.js:",
        "(pass) a",
        "b.test.js:",
        "(pass) b",
        " 2 pass",
        " 0 fail",
        " 2 expect() calls",
        "Ran 2 tests across 2 files.",
      ],
      exitCode: 0,
    });
    // One process runs both test files, and it writes its count where that is 0 too.
    const compared = comparedWithDisk(cwd);
    expect(compared).toHaveLength(1);
    // Two realms.
    if (takesFilesOut) expect(compared[0]).toBeWithin(1, 2 * moduleCount + 1);
    else expect(compared).toEqual([0]);
  },
  240_000,
);

test.each(ways)("a later test file imports the new text: %j %s", async (flags, words) => {
  const { plain, compiled } = await ended(passing, flags, words);
  expect(plain.cases.get("direct")).toEqual({
    printed: ["direct a 1", "direct b 100 110 110 bump,count,extra"],
    reported: ["direct-a.test.js:", "(pass) a", "direct-b.test.js:", "(pass) b"],
  });
  expect(compiled.cases.get("direct")).toEqual(plain.cases.get("direct"));
});

test.each(ways)("through a module that has not run yet: %j %s", async (flags, words) => {
  const { plain, compiled } = await ended(passing, flags, words);
  expect(plain.cases.get("through")).toEqual({
    printed: ["through a 1", "through b 100,110,110"],
    reported: ["through-a.test.js:", "(pass) a", "through-b.test.js:", "(pass) b"],
  });
  expect(compiled.cases.get("through")).toEqual(plain.cases.get("through"));
});

test.each(ways)("a name that the new text lacks fails the later test file: %j %s", async (flags, words) => {
  const { plain, compiled } = await ended(failing, flags, words);
  expect(plain.cases.get("lacks")).toEqual({
    printed: ["lacks a 1"],
    reported: [
      "lacks-a.test.js:",
      "(pass) a",
      "lacks-b.test.js:",
      "# Unhandled error between tests",
      "-------------------------------",
      "SyntaxError: Export named 'bump' not found in module '<dir>/lacks-state.js'.",
      "-------------------------------",
    ],
  });
  expect(compiled.cases.get("lacks")).toEqual(plain.cases.get("lacks"));
});
