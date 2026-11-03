import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A test run in layers has three programs in one realm: the packages and Bun's own library, the files of the project, and the test files.
// Each was compiled without the others' code, so each could take an object of the realm for one that its own copy of the library made, or make a second one.
// Every project here prints what it sees; a run in layers has to print what plain Bun prints.
const part = (name: string) =>
  readFileSync(join(import.meta.dir, "layers-of-a-test-run-share-one-realm", name + ".txt"), "utf8");
// A checkout may end the lines of a fixture with \r\n.
const listed = (name: string) =>
  part(name)
    .split(/\r?\n/)
    .filter(line => line);

async function seen(directory: string, flags: string[], words: string) {
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "test", ...flags, "--isolate", "--parallel=4", "--timeout=60000"],
    directory,
    {
      ...bunEnv,
      BUN_DEBUG_TEST_AOT_WORDS: words,
    },
  );
  const all = (stdout + "\n" + stderr).split("\n");
  return [
    {
      lines: all.filter(line => line.startsWith("SEEN")).sort(),
      ended: {
        // The last lines of the run, without the time that it took.
        summary: stderr.match(/^ \d+ pass\n(?:.*\n)*?Ran \d+ tests across \d+ files\./m)?.[0],
        deadWorkers: all.filter(line => line.includes("worker crashed")),
        exitCode,
      },
    },
    // A run that is told how many test files go to a program says how it is built.
    stderr.match(/^AOT test run \| .*\b(test files \d+ \| to a program \d+)/m)?.[1],
  ] as const;
}

/** What a project prints and how its run ends, under plain Bun and in layers with `filesOfPiece` test files to a program. */
async function seenPlainAndInLayers(name: string, files: Record<string, string>, filesOfPiece: number) {
  using dir = tempDir(name, { "package.json": `{ "name": "p", "type": "module" }`, "tsconfig.json": `{}`, ...files });
  const [[plain], [layers, programs]] = await Promise.all([
    seen(String(dir), [], ""),
    seen(String(dir), ["--aot"], `TestRunLayers:2,TestRunPartFiles:${filesOfPiece}`),
  ]);
  const testFiles = Object.keys(files).filter(path => path.endsWith(".test.js")).length;
  expect(programs).toBe(`test files ${testFiles} | to a program ${filesOfPiece}`);
  return { plain, layers };
}

const expressions = listed("made-by-the-library");
const number = (index: number) => String(index).padStart(3, "0");
// Node's console asks its streams for more than `write`, so the statement with this one throws, under plain Bun too.
const throwsInPlainBun = (expression: string) => expression.includes("new console.Console({ stdout: {");
// One statement starts a program named `true`, and throws where the system has none. The first two tests state what comes through.
const lacksTrue = !Bun.which("true");
if (lacksTrue)
  console.error(
    "SKIPPED: test/aot/layers-of-a-test-run-share-one-realm.test.ts: the first two tests need a program named `true` in PATH",
  );

// Most of a run in layers is the build of its lowest layer. For the first two tests that layer is the same program, Bun's own library alone, so their test files are one project, which runs once in each way.
// The third test keeps a project of its own: its lowest layer holds a package too, and a build of these two takes every module for one that a test may mock, because one expression reads `Bun.jest`.
let seenOnce: ReturnType<typeof seeExpressions> | undefined;
const expressionsSeen = () => (seenOnce ??= seeExpressions());
async function seeExpressions() {
  const withRequire = `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);\n`;
  const files: Record<string, string> = {
    "src/all.js":
      withRequire +
      "export const all = [\n" +
      expressions.map(expression => `  async () => (${expression}),\n`).join("") +
      "];\n",
  };
  // A program above the layers holds four test files that follow one another by name. A name begins with the number of its four, so that no program but the last holds files of both tests.
  const count = { statement: 0, value: 0 };
  const name = (kind: keyof typeof count, index: number) =>
    `${number(Math.floor(count[kind]++ / 4))}-${kind}-${number(index)}.test.js`;
  expressions.forEach((expression, index) => {
    files[name("statement", index)] =
      `import { test } from "bun:test";\ntest("f", () => { ${expression}; console.log("SEEN", "${number(index)}", "came through"); });\n`;
    // Compiled code words that TypeError of the library otherwise.
    if (throwsInPlainBun(expression)) return;
    files[name("value", index)] = `import { test } from "bun:test"; import { all } from "./src/all.js"; ${withRequire}
const note = (...parts) => console.log("SEEN", "${number(index)}", ...parts); const clean = error => "threw " + error.name + " " + String(error.message).slice(0, 90);
test("in the test file", async () => { try { note("own", String(await (${expression}))); } catch (error) { note("own", clean(error)); } });
test("in the file of the project", async () => { try { note("theirs", String(await all[${index}]())); } catch (error) { note("theirs", clean(error)); } });
`;
  });
  const { plain, layers } = await seenPlainAndInLayers("aot-layers-made-by-the-library", files, 4);
  const isOfStatement = (line: string) => line.endsWith(" came through");
  const byTest = ({ lines, ended }: typeof plain) => ({
    statements: lines.filter(isOfStatement),
    values: lines.filter(line => !isOfStatement(line)),
    ended,
  });
  return { plain: byTest(plain), layers: byTest(layers) };
}
// How both runs of that project end: the statement that throws fails its test.
const endOfExpressions = {
  summary: " 351 pass\n 1 fail\nRan 352 tests across 235 files.",
  deadWorkers: [],
  exitCode: 1,
};

test.skipIf(lacksTrue)(
  "a value that the library or native code makes, used by one statement of a test file",
  async () => {
    const { plain, layers } = await expressionsSeen();
    const stated = {
      statements: expressions.flatMap((expression, index) =>
        throwsInPlainBun(expression) ? [] : [`SEEN ${number(index)} came through`],
      ),
      ended: endOfExpressions,
    };
    expect({ statements: plain.statements, ended: plain.ended }).toEqual(stated);
    expect({ statements: layers.statements, ended: layers.ended }).toEqual(stated);
  },
  600000,
);

test.skipIf(lacksTrue)(
  "the same values, in a test file and in a file of the project",
  async () => {
    const { plain, layers } = await expressionsSeen();
    // `[number, value]` of each expression, as the test file or the file of the project has it under plain Bun.
    const valuesIn = (place: string) =>
      plain.values.flatMap(line => {
        const found = line.match(new RegExp(`^SEEN (\\d+) ${place} (.*)$`));
        return found ? [[found[1], found[2]]] : [];
      });
    const [own, theirs] = [valuesIn("own"), valuesIn("theirs")];
    const asked = expressions.flatMap((expression, index) => (throwsInPlainBun(expression) ? [] : [number(index)]));
    expect(own.map(([index]) => index)).toEqual(asked);
    expect(theirs.map(([index]) => index)).toEqual(asked);
    expect([...own, ...theirs].filter(([, value]) => value.startsWith("threw "))).toEqual([]);
    // The file of the project answers second, in the realm of the test file: it counts that file's listener and its mark too, and it is not the main module.
    const differ = own.flatMap(([index, value], at) =>
      value === theirs[at][1] ? [] : [[index, value, theirs[at][1]]],
    );
    expect(differ).toEqual([
      ["005", "1", "2"],
      ["046", "number,number,a,number,1", "number,number,a,number,2"],
      ["084", "function,string,function,string,true", "function,string,function,string,false"],
    ]);
    expect(plain.ended).toEqual(endOfExpressions);
    expect({ values: layers.values, ended: layers.ended }).toEqual({ values: plain.values, ended: endOfExpressions });
  },
  600000,
);

test("one of each thing, one queue of each kind, and what one layer sets the others see", async () => {
  const shared = part("shared");
  const testFile = shared.replaceAll(/^export const /gm, "const ") + part("asks");
  const { plain, layers } = await seenPlainAndInLayers(
    "aot-layers-one-realm",
    {
      "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "type": "module", "main": "index.js" }`,
      "node_modules/pkg/index.js": shared,
      "src/shared.js": shared,
      "one.test.js": testFile,
      "two.test.js": testFile,
    },
    1,
  );
  const stated = {
    // Each of the two test files gives every answer once.
    lines: listed("answers")
      .flatMap(answer => [answer, answer])
      .sort(),
    ended: { summary: " 12 pass\n 0 fail\nRan 12 tests across 2 files.", deadWorkers: [], exitCode: 0 },
  };
  expect(plain).toEqual(stated);
  expect(layers).toEqual(stated);
}, 600000);
