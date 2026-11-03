import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { run } from "./harness/run";
import { beforeAll, test } from "./supported";

// `export { absent } from "./esm.mjs"` fails where the loader links it. A compiled test run leaves such a file to the loader, which reads it
// from disk and asks for esm.mjs. Another file of the run imports esm.mjs too, so it is compiled, and the loader has to be given it:
// the test file fails with the words of `bun test`, and the CommonJS files that the loader runs on its way run.
const testFile = (text: string) => `import { test } from "bun:test";\n${text}\ntest("runs", () => {});\n`;

const files: Record<string, string> = {
  "package.json": `{}`,
  "src/esm.mjs": `export const one = 1; export function double(list) { return list.map(x => x * 2); } console.log("esm.mjs runs");`,
  "src/other.mjs": `export const two = 2; console.log("other.mjs runs");`,
  "src/file.cjs": `exports.three = 3; console.log("file.cjs runs");`,
  "src/data.json": `{ "four": 4 }`,
  "src/good.mjs": `
    export { one, double } from "./esm.mjs";
    export { two } from "./other.mjs";
    import common from "./file.cjs";
    import data from "./data.json";
    export const sum = common.three + data.four;
    console.log("good.mjs runs");`,
  "good.test.mjs": testFile(`
    import * as names from "./src/good.mjs";
    console.log("good:", Object.keys(names).join(), names.sum, names.double([1, 2]).join());`),

  "src/exports-absent.mjs": `export { absent } from "./esm.mjs"; console.log("never printed");`,
  "exports-a-name-that-is-not-there.test.mjs": testFile(`
    import * as names from "./src/exports-absent.mjs";
    console.log("never printed", Object.keys(names).join());`),

  "src/imports-absent.mjs": `import { absent } from "./esm.mjs"; console.log("never printed", absent);`,
  "imports-a-name-that-is-not-there.test.mjs": testFile(`
    import "./src/imports-absent.mjs";
    console.log("never printed");`),

  "src/only-below.mjs": `export { two } from "./other.mjs"; console.log("never printed");`,
  "src/through.mjs": `export { two, absent } from "./only-below.mjs"; console.log("never printed");`,
  "through-a-file-that-nothing-else-imports.test.mjs": testFile(`
    import * as names from "./src/through.mjs";
    console.log("never printed", Object.keys(names).join());`),

  "src/beside.mjs": `
    import common from "./file.cjs";
    import data from "./data.json";
    export { absent } from "./other.mjs";
    console.log("never printed", common, data);`,
  "beside-a-commonjs-file-and-data.test.mjs": testFile(`
    import "./src/beside.mjs";
    console.log("never printed");`),

  "by-import-call.test.mjs": testFile(`
    import { one } from "./src/good.mjs";
    const said = await import("./src/exports-absent.mjs").then(() => "loaded", error => error.name + ": " + error.message);
    console.log("by import():", one, said);`),
};

// Nothing that holds code is shared here.
const filesThatShareData: Record<string, string> = {
  "package.json": `{}`,
  "src/data.json": `{ "four": 4 }`,
  "src/good.mjs": `import data from "./data.json"; export const four = data.four; console.log("good.mjs runs");`,
  "src/lone.mjs": `export const lone = 1;`,
  "src/bad.mjs": `import data from "./data.json"; export { absent } from "./lone.mjs"; console.log("never printed", data);`,
  "good.test.mjs": testFile(`import { four } from "./src/good.mjs"; console.log("good:", four);`),
  "bad.test.mjs": testFile(`import "./src/bad.mjs"; console.log("never printed");`),
};

type Report = {
  /** What the files of the project print, line by line. */
  printed: string[];
  /** Under each test file: how its tests end, and what its load fails with. */
  byFile: Record<string, string[]>;
  /** The last lines of a run: the tests that passed and failed, the loads that failed, the tests and files that ran. */
  counts: string[];
  exitCode: number | null;
  /** How a compiled run is built. It says so first where one of its words begins with `TestRun`, and plain Bun never does. */
  form?: string;
};

async function runTests(folder: string, flags: string[], words = ""): Promise<Report> {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  const byFile: Record<string, string[]> = {};
  const counts: string[] = [];
  let file = "";
  for (const line of stderr.replaceAll(folder, ".").replaceAll("\\", "/").split("\n")) {
    if (/^\S+\.test\.mjs:$/.test(line)) byFile[(file = line)] = [];
    else if (file && /^(\((pass|fail)\)|\w*[Ee]rror:)/.test(line))
      byFile[file].push(line.replace(/ \[[\d.]+ms\]$/, ""));
    else if (/^ *\d+ (pass|fail|errors?)$|^Ran \d+ tests? across \d+ files?\./.test(line))
      counts.push(line.trim().replace(/ \[[\d.]+m?s\]$/, ""));
  }
  const printed = stdout.replace(/^bun test .*\n/, "").replace(/\n$/, "");
  // With BUN_JSC_logAOTPhaseTimes other lines of a run begin with the same words.
  const form = stderr.match(/^AOT test run \| ((?:layers|one program|programs without layers)\b.*)$/m)?.[1];
  return { printed: printed.split("\n"), byFile, counts, exitCode, ...(form !== undefined && { form }) };
}

// A run that ignored `--aot` would say what plain Bun says. A compiled run that is asked says first how it is built: the test
// files are one program, or each is a program above the layers. A Bun that loads one program a realm says that in the same line.
const oneProgram = (testFiles: number) => new RegExp(`^one program\\b.* \\| test files ${testFiles}$`);
const aProgramToATestFile = /^(layers 2|programs without layers\b.*) \| test files 6 \| to a program 1\b/;

// What `bun test` says of `files`. Nothing says "never printed": a file whose link fails does not run, and neither does the
// test file that imports it.
const howTheTestFilesEnd = {
  byFile: {
    "beside-a-commonjs-file-and-data.test.mjs:": ["SyntaxError: export 'absent' not found in './other.mjs'"],
    "by-import-call.test.mjs:": ["(pass) runs"],
    "exports-a-name-that-is-not-there.test.mjs:": ["SyntaxError: export 'absent' not found in './esm.mjs'"],
    "good.test.mjs:": ["(pass) runs"],
    "imports-a-name-that-is-not-there.test.mjs:": [
      "SyntaxError: Export named 'absent' not found in module './src/esm.mjs'.",
    ],
    "through-a-file-that-nothing-else-imports.test.mjs:": [
      "SyntaxError: export 'absent' not found in './only-below.mjs'",
    ],
  },
  counts: ["2 pass", "4 fail", "4 errors", "Ran 6 tests across 6 files."],
  exitCode: 1,
};
const said: Record<string, Report> = {
  // In one realm a file runs once. beside-a-commonjs-file-and-data.test.mjs is the first test file: the loader has run file.cjs
  // by the time the link of beside.mjs fails.
  "": {
    ...howTheTestFilesEnd,
    printed: [
      "file.cjs runs",
      "esm.mjs runs",
      "other.mjs runs",
      "good.mjs runs",
      "by import(): 1 SyntaxError: export 'absent' not found in './esm.mjs'",
      "good: double,one,sum,two 7 2,4",
    ],
  },
  // With a realm to a test file that one, by-import-call.test.mjs and good.test.mjs each run what they load.
  "--isolate": {
    ...howTheTestFilesEnd,
    printed: [
      "file.cjs runs",
      "file.cjs runs",
      "esm.mjs runs",
      "other.mjs runs",
      "good.mjs runs",
      "by import(): 1 SyntaxError: export 'absent' not found in './esm.mjs'",
      "file.cjs runs",
      "esm.mjs runs",
      "other.mjs runs",
      "good.mjs runs",
      "good: double,one,sum,two 7 2,4",
    ],
  },
};

let dir: ReturnType<typeof tempDir> | undefined;
const plain: Record<string, Report> = {};
beforeAll(async () => {
  dir = tempDir("a-module-whose-link-fails", files);
  for (const flag of ["", "--isolate"]) plain[flag] = await runTests(String(dir), flag ? [flag] : []);
});
afterAll(() => dir?.[Symbol.dispose]());

test.each([
  ["in one realm", ""],
  ["a realm to a file", "--isolate"],
])("what plain Bun says: %s", (_, flag) => {
  expect(plain[flag]).toEqual(said[flag]);
});

// Each test below holds one compiled run, and the five run beside one another, as many as `--max-concurrency` says. A debug
// build of Bun takes five minutes of processor time for one of them: there they run one after another.
const testOfOneRun = isDebug ? test.serial : test.concurrent;

// Over layers every test file has a realm of its own, as under --isolate.
testOfOneRun.each([
  ["one program, in one realm", "", "TestRunLayers:0", oneProgram(6)],
  ["one program, a realm to a file", "--isolate", "TestRunLayers:0", oneProgram(6)],
  ["two layers", "--isolate", "TestRunLayers:2,TestRunPartFiles:1", aProgramToATestFile],
] as const)("each test file fails as under bun test, and the others run: %s", async (_, flag, words, form) => {
  const compiled = await runTests(String(dir), ["--aot", ...(flag ? [flag] : [])], words);
  expect(compiled).toEqual({ ...plain[flag], form: expect.stringMatching(form) });
});

testOfOneRun("in a run of one test file", async () => {
  using dir = tempDir("a-module-whose-link-fails-one-file", files);
  const folder = String(dir);
  const plain = await runTests(folder, ["by-import-call"]);
  expect(plain).toEqual({
    printed: [
      "file.cjs runs",
      "esm.mjs runs",
      "other.mjs runs",
      "good.mjs runs",
      "by import(): 1 SyntaxError: export 'absent' not found in './esm.mjs'",
    ],
    byFile: { "by-import-call.test.mjs:": ["(pass) runs"] },
    counts: ["1 pass", "0 fail", "Ran 1 test across 1 file."],
    exitCode: 0,
  });
  const compiled = await runTests(folder, ["--aot", "by-import-call"], "TestRunSaysItsForm");
  expect(compiled).toEqual({ ...plain, form: expect.stringMatching(oneProgram(1)) });
});

testOfOneRun("where a file of data is all that is shared", async () => {
  using dir = tempDir("a-module-whose-link-fails-data", filesThatShareData);
  const folder = String(dir);
  const plain = await runTests(folder, []);
  expect(plain).toEqual({
    printed: ["good.mjs runs", "good: 4"],
    byFile: {
      "bad.test.mjs:": ["SyntaxError: export 'absent' not found in './lone.mjs'"],
      "good.test.mjs:": ["(pass) runs"],
    },
    counts: ["1 pass", "1 fail", "1 error", "Ran 2 tests across 2 files."],
    exitCode: 1,
  });
  const compiled = await runTests(folder, ["--aot"], "TestRunSaysItsForm");
  expect(compiled).toEqual({ ...plain, form: expect.stringMatching(oneProgram(2)) });
});
