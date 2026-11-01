// `bun test` hands every file `test`, `expect`, `jest` and the like. In a compiled run a CommonJS file that begins with a comment like
// `/** @license MIT */` did not get them: a test file stopped with "Cannot access '%test:test' before initialization", and in a file that a
// test requires `typeof jest` was "undefined". react-dom 18 asks exactly that to find out whether act() applies.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { beforeAll, test } from "./supported";

raiseDefaultTimeout(120_000);

const asksInFunction = `
if (process.env.NODE_ENV !== "production") {
  (function () {
    function kindOfJest() {
      {
        var kind = typeof jest;
        return kind;
      }
    }
    exports.kindOfJest = kindOfJest;
    exports.atLoad = kindOfJest();
    if ("function") {
    }
  })();
}`;

// A test file names itself in the line that it prints: a run may hold several of them.
const says = (file: string) => `("the names are there", () => {
  expect(1).toBe(1);
  console.log("SEEN ${file}", typeof jest, typeof jest.fn, typeof describe);
});`;

const files = {
  "package.json": `{ "name": "p" }`,
  "node_modules/asks/package.json": `{ "name": "asks", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/asks/index.js": `/**\n * @license MIT\n */\n"use strict";\n${asksInFunction}`,
  "one-line.test.cjs": `/** @license MIT */\nconst path = require("node:path");\ntest${says("one-line.test.cjs")}`,
  "docblock.test.cjs": `/**\n * Copyright.\n *\n * @jest-environment node\n */\n"use strict";\nconst path = require("node:path");\ntest${says("docblock.test.cjs")}`,
  "two-comments.test.cjs": `/** @license MIT */\n/** @type {number} */\nconst one = 1;\nmodule.exports = one;\ntest${says("two-comments.test.cjs")}`,
  "behind-a-line.test.cjs": `\n/** @license MIT */\nconst path = require("node:path");\ntest${says("behind-a-line.test.cjs")}`,
  "module.test.mjs": `/** @license MIT */\ntest${says("module.test.mjs")}\nexport {};`,
  "package.test.cjs": `const asks = require("asks");\ntest("a package asks", () => {\n  console.log("SEEN package.test.cjs", asks.atLoad, asks.kindOfJest());\n});`,
};
const testFiles = Object.keys(files).filter(name => name.includes(".test."));
const withoutPackage = testFiles.filter(file => file !== "package.test.cjs");

const noLayers = "this Bun loads one program a realm";
// In either form a test file is a program of its own. `runs`: the test files of each run. A build in layers compiles all of
// Bun's own code, with the packages, below the test files, whatever those are. So the test files that import no package stand
// on the same layers, and one run builds these for all of them. `form`: what a run of so many test files says of its build.
const forms = {
  "one program": {
    words: "TestRunLayers:0",
    runs: testFiles.map(file => [file]),
    form: (count: number) => new RegExp(`^one program(: ${noLayers})? \\| test files ${count}$`),
  },
  "two layers": {
    words: "TestRunLayers:2,TestRunPartFiles:1",
    runs: [withoutPackage, ["package.test.cjs"]],
    form: (count: number) =>
      new RegExp(`^(layers 2|programs without layers: ${noLayers}) \\| test files ${count} \\| to a program 1( \\||$)`),
  },
};

/** `bun test` over test files together: compiled where `words` say in which form, plain without them. */
async function runTests(together: string[], words?: string) {
  using dir = tempDir("a-commonjs-file-that-begins-with-a-comment", files);
  const command = [bunExe(), "test", ...(words ? ["--aot"] : []), ...together.map(file => `./${file}`)];
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run(command, String(dir), env);
  const ofTheBuild = /^AOT test run \| (.*)\n/gm;
  return {
    /** What a compiled run says of how it is built. */
    form: [...stderr.matchAll(ofTheBuild)].map(line => line[1]),
    /** Everything else, without the times. */
    printed: {
      stdout: normalizeBunSnapshot(stdout),
      stderr: normalizeBunSnapshot(stderr.replace(ofTheBuild, "")),
      exitCode,
    },
  };
}
type Ran = Awaited<ReturnType<typeof runTests>>;

const commands = new Map<string, Promise<Ran>>();
/** One run for each command, however many tests ask for it. */
function ran(together: string[], words?: string) {
  return commands.getOrInsertComputed(JSON.stringify([together, words]), () => {
    const started = runTests(together, words);
    // A run that fails is reported by the tests that wait for it, not between two tests.
    started.catch(() => {});
    return started;
  });
}

// The builds in layers take longest. They begin before the first test, and the builds of one program follow one another
// beside them.
beforeAll(() => {
  const { words, runs } = forms["two layers"];
  for (const together of runs) ran(together, words);
});
// A run whose tests a filter has left out ends before the file does.
afterAll(() => Promise.allSettled(commands.values()));

/** What a run says of one test file: the lines that the file prints, and how its tests end. */
const saidOf = ({ printed }: Ran, file: string) => ({
  printed: printed.stdout.split("\n").filter(line => line.startsWith(`SEEN ${file} `)),
  reported: printed.stderr.split("\n\n").filter(block => block.startsWith(`${file}:\n`)),
});

test("plain bun test reports each test file of a run under its name", async () => {
  const { printed } = await ran(withoutPackage);
  expect(printed.stdout).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    SEEN one-line.test.cjs object function function
    SEEN docblock.test.cjs object function function
    SEEN two-comments.test.cjs object function function
    SEEN behind-a-line.test.cjs object function function
    SEEN module.test.mjs object function function"
  `);
  expect(printed.stderr).toMatchInlineSnapshot(`
    "one-line.test.cjs:
    (pass) the names are there

    docblock.test.cjs:
    (pass) the names are there

    two-comments.test.cjs:
    (pass) the names are there

    behind-a-line.test.cjs:
    (pass) the names are there

    module.test.mjs:
    (pass) the names are there

     5 pass
     0 fail
     5 expect() calls
    Ran 5 tests across 5 files."
  `);
  expect(printed.exitCode).toBe(0);
});

for (const [title, { words, runs, form }] of Object.entries(forms)) {
  for (const together of runs) {
    // The test of a file reads what the run says of that file, so no other test file of the run decides it.
    test.each(together)(`%s: ${title}`, async file => {
      const [plain, compiled] = await Promise.all([ran([file]), ran(together, words)]);
      const ofPackage = file === "package.test.cjs";
      expect(saidOf(plain, file)).toEqual({
        printed: [`SEEN ${file} ${ofPackage ? "object object" : "object function function"}`],
        reported: [`${file}:\n(pass) ${ofPackage ? "a package asks" : "the names are there"}`],
      });
      expect({ form: compiled.form, ...saidOf(compiled, file) }).toEqual({
        form: [expect.stringMatching(form(together.length))],
        ...saidOf(plain, file),
      });
    });

    test(`the run of ${together.join(", ")} prints what plain bun test prints: ${title}`, async () => {
      const [plain, compiled] = await Promise.all([ran(together), ran(together, words)]);
      expect(compiled).toEqual({ form: [expect.stringMatching(form(together.length))], printed: plain.printed });
      expect(compiled.printed.exitCode).toBe(0);
    });
  }
}
