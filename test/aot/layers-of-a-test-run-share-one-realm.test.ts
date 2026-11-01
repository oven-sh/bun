import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { testOneByOne as test } from "./supported";

// A test run in layers has three programs in one realm: the packages and Bun's own library, the files of the project, and the test files.
// Each was compiled without the others' code, so each could take an object of the realm for one that its own copy of the library made, or make a second one.
// Every project here prints what it sees; a run in layers has to print what plain Bun prints.
const part = (name: string) =>
  readFileSync(join(import.meta.dir, "layers-of-a-test-run-share-one-realm", name + ".txt"), "utf8");

async function seen(directory: string, flags: string[], words: string) {
  const { stdout, stderr } = await run(
    [bunExe(), "test", ...flags, "--isolate", "--parallel=4", "--timeout=60000"],
    directory,
    {
      ...bunEnv,
      BUN_DEBUG_TEST_AOT_WORDS: words,
    },
  );
  const all = stdout + "\n" + stderr;
  return {
    lines: all
      .split("\n")
      .filter(line => line.startsWith("SEEN"))
      .sort(),
    deadWorkers: all.split("\n").filter(line => line.includes("worker crashed")),
  };
}

async function expectLayersToSeeWhatPlainSees(
  name: string,
  files: Record<string, string>,
  filesOfPiece: number,
  fewestLines: number,
) {
  using dir = tempDir(name, { "package.json": `{ "name": "p", "type": "module" }`, "tsconfig.json": `{}`, ...files });
  const plain = await seen(String(dir), [], "");
  const layers = await seen(
    String(dir),
    ["--aot"],
    `TestRunLayers:2,TestRunPartFiles:${filesOfPiece},TestRunPartsGoOnAfterCrash`,
  );
  expect(plain.lines.length).toBeGreaterThanOrEqual(fewestLines);
  expect(layers.deadWorkers).toEqual([]);
  expect(layers.lines).toEqual(plain.lines);
}

const expressions = part("made-by-the-library")
  .split("\n")
  .filter(line => line);
const number = (index: number) => String(index).padStart(3, "0");

test("a value that the library or native code makes, used by one statement of a test file", async () => {
  const files: Record<string, string> = {};
  expressions.forEach((expression, index) => {
    files[`t${number(index)}.test.js`] =
      `import { test } from "bun:test";\ntest("f", () => { ${expression}; console.log("SEEN", "${number(index)}", "came through"); });\n`;
  });
  await expectLayersToSeeWhatPlainSees("aot-layers-made-by-the-library-bare", files, 4, expressions.length - 3);
}, 600000);

test("the same values, in a test file and in a file of the project", async () => {
  const withRequire = `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);\n`;
  const files: Record<string, string> = {
    "src/all.js":
      withRequire +
      "export const all = [\n" +
      expressions.map(expression => `  async () => (${expression}),\n`).join("") +
      "];\n",
  };
  expressions.forEach((expression, index) => {
    // Compiled code words one TypeError of the library otherwise.
    if (expression.includes("new console.Console({ stdout: {")) return;
    files[`t${number(index)}.test.js`] =
      `import { test } from "bun:test"; import { all } from "./src/all.js"; ${withRequire}
const note = (...parts) => console.log("SEEN", "${number(index)}", ...parts); const clean = error => "threw " + error.name + " " + String(error.message).slice(0, 90);
test("in the test file", async () => { try { note("own", String(await (${expression}))); } catch (error) { note("own", clean(error)); } });
test("in the file of the project", async () => { try { note("theirs", String(await all[${index}]())); } catch (error) { note("theirs", clean(error)); } });
`;
  });
  await expectLayersToSeeWhatPlainSees("aot-layers-made-by-the-library", files, 4, 2 * expressions.length - 2);
}, 600000);

test("one of each thing, one queue of each kind, and what one layer sets the others see", async () => {
  const shared = part("shared");
  const testFile = shared.replaceAll(/^export const /gm, "const ") + part("asks");
  await expectLayersToSeeWhatPlainSees(
    "aot-layers-one-realm",
    {
      "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "type": "module", "main": "index.js" }`,
      "node_modules/pkg/index.js": shared,
      "src/shared.js": shared,
      "one.test.js": testFile,
      "two.test.js": testFile,
    },
    1,
    100,
  );
}, 600000);
