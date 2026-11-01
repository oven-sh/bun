import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { afterAll } from "./harness/default-timeout";
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

type Report = { printed: string; byFile: Record<string, string[]>; exitCode: number | null };

async function runTests(folder: string, flags: string[], words = ""): Promise<Report> {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  const byFile: Record<string, string[]> = {};
  let file = "";
  for (const line of stderr.replaceAll(folder, ".").split("\n")) {
    if (/^\S+\.test\.mjs:$/.test(line)) byFile[(file = line)] = [];
    else if (file && /^(\((pass|fail)\)|\w*[Ee]rror:)/.test(line))
      byFile[file].push(line.replace(/ \[[\d.]+ms\]$/, ""));
  }
  return { printed: stdout.replace(/^bun test .*\n/, ""), byFile, exitCode };
}

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
  expect(plain[flag].byFile).toMatchObject({
    "good.test.mjs:": ["(pass) runs"],
    "by-import-call.test.mjs:": ["(pass) runs"],
    "exports-a-name-that-is-not-there.test.mjs:": ["SyntaxError: export 'absent' not found in './esm.mjs'"],
    "through-a-file-that-nothing-else-imports.test.mjs:": [
      "SyntaxError: export 'absent' not found in './only-below.mjs'",
    ],
    "beside-a-commonjs-file-and-data.test.mjs:": ["SyntaxError: export 'absent' not found in './other.mjs'"],
  });
  expect(plain[flag].printed).toContain("by import(): 1 SyntaxError: export 'absent' not found in './esm.mjs'");
});

// Over layers every test file has a realm of its own, as under --isolate.
test.each([
  ["one program, in one realm", "", "TestRunLayers:0"],
  ["one program, a realm to a file", "--isolate", "TestRunLayers:0"],
  ["two layers", "--isolate", "TestRunLayers:2,TestRunPartFiles:1"],
])("each test file fails as under bun test, and the others run: %s", async (_, flag, words) => {
  expect(await runTests(String(dir), ["--aot", ...(flag ? [flag] : [])], words)).toEqual(plain[flag]);
});

test("in a run of one test file", async () => {
  using dir = tempDir("a-module-whose-link-fails-one-file", files);
  const folder = String(dir);
  const plain = await runTests(folder, ["by-import-call"]);
  expect(plain.printed).toContain("by import(): 1 SyntaxError: export 'absent' not found in './esm.mjs'");
  expect(await runTests(folder, ["--aot", "by-import-call"])).toEqual(plain);
});

test("where a file of data is all that is shared", async () => {
  using dir = tempDir("a-module-whose-link-fails-data", filesThatShareData);
  const folder = String(dir);
  const plain = await runTests(folder, []);
  expect(plain.byFile).toEqual({
    "bad.test.mjs:": ["SyntaxError: export 'absent' not found in './lone.mjs'"],
    "good.test.mjs:": ["(pass) runs"],
  });
  expect(await runTests(folder, ["--aot"])).toEqual(plain);
});
