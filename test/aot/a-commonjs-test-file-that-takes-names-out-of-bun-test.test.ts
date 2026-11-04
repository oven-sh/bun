// `const { test } = require("bun:test")` takes one name, as `import { test } from "bun:test"` does. A compiled test run read it as the whole object of bun:test
// going out of sight, `mock` and `spyOn` with it: every module of the run counted as mocked and every object as spied on. Flow then knew so little that a package
// which patches `fetch` through a helper was refused: "Cannot assign to fetch because built-in objects are read-only in compiled code". nock 15 loads that way.
import { expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// A test file names itself in the lines that it prints: a run may hold several of them.
const body = (file: string) => `("a package patches fetch through a helper", () => {
  const { activate } = require("patches");
  const real = fetch;
  const undo = activate();
  console.log("SEEN ${file}", typeof fetch, fetch === real);
  undo();
  console.log("SEEN ${file}", fetch === real);
});`;

const files = {
  "package.json": `{ "name": "p" }`,
  "node_modules/patches/package.json": `{ "name": "patches", "version": "1.0.0", "type": "module", "main": "index.mjs" }`,
  "node_modules/patches/registry.mjs": `
    class Registry {
      applyPatch(owner, key, next) {
        const before = Object.getOwnPropertyDescriptor(owner, key);
        Object.defineProperty(owner, key, { value: next(owner[key]), enumerable: true, configurable: true });
        return () => Object.defineProperty(owner, key, before);
      }
    }
    export const registry = new Registry();`,
  "node_modules/patches/index.mjs": `
    import { registry } from "./registry.mjs";
    export function activate() {
      return registry.applyPatch(globalThis, "fetch", real => (...all) => real(...all));
    }`,
  "names.test.cjs": `const { test } = require("bun:test");\ntest${body("names.test.cjs")}`,
  "member.test.cjs": `require("bun:test").test${body("member.test.cjs")}`,
  "several.test.cjs": `const { test, expect, describe } = require("bun:test");\ndescribe("d", () => { test${body("several.test.cjs")} });`,
  "meta.test.mjs": `const { test } = import.meta.require("bun:test");\nconst require = import.meta.require;\ntest${body("meta.test.mjs")}`,
};
const commonJs = ["names.test.cjs", "member.test.cjs", "several.test.cjs"];
const testFiles = [...commonJs, "meta.test.mjs"];

const noLayers = "this Bun loads one program a realm";
// A build is what costs, so the test files of a form share a run. What the scan finds in one file opens the whole run, so each test also reads what the scan
// says of its own file. `runs`: the test files of each run. Over layers meta.test.mjs has a run to itself: it holds its loader in a variable, which makes the
// lowest layer of its run keep more of Bun's own code, and the programs above that layer differ with it. The three CommonJS files stand on the same layers,
// and `TestRunPartFiles:1` keeps each a program of its own above them. `form`: what a run of so many test files says of its build.
const forms = {
  "one program": {
    words: "TestRunLayers:0",
    runs: [testFiles],
    form: (count: number) => new RegExp(`^one program(: ${noLayers})? \\| test files ${count}$`),
  },
  "two layers": {
    words: "TestRunLayers:2,TestRunPartFiles:1",
    runs: [commonJs, ["meta.test.mjs"]],
    form: (count: number) =>
      new RegExp(`^(layers 2|programs without layers: ${noLayers}) \\| test files ${count} \\| to a program 1( \\||$)`),
  },
};

// A compiled run writes the log of its builds between the lines of the runner: each test file, how its tests end, why one fails, and the counts.
const isOfReport =
  /^(?:\S+\.test\.[cm]js:|\((?:pass|fail|skip|todo)\) .*|(?:\w*Error|error): .*| *\d+ (?:pass|fail|skip|todo|errors?|expect\(\) calls)|Ran \d+ tests? across \d+ files?\..*)$/;
const isOfLog = /^(?:AOT |\s*\w+: wall )/;

/** `bun test` over test files together: compiled where `words` say in which form, plain without them. */
async function runTests(together: string[], words?: string) {
  using dir = tempDir("a-commonjs-test-file-that-takes-names-out-of-bun-test", files);
  const command = [bunExe(), "test", ...(words ? ["--aot"] : []), ...together.map(file => `./${file}`)];
  // The scan says what it finds in a file only with the log of the phases.
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: words ? "1" : undefined };
  const { stdout, stderr, exitCode } = await run(command, String(dir), env);
  const lines = stderr.split(/\r?\n/);
  // The first scan is that of the test files.
  const scan =
    /^AOT test run \| scan of (\d+) files and \d+ beside them \| .*\| mocks any module (\w+) \| .*\| spies on objects from somewhere (\w+)$/m.exec(
      stderr,
    );
  return {
    stdout,
    stderr,
    exitCode,
    /** What the runner says on stderr, without the times. */
    report: lines.filter(line => isOfReport.test(line)).map(line => line.replace(/ \[[\d.]+m?s\]$/, "")),
    /** Of a run that fails: what it says beside the log of its builds. */
    failure: exitCode === 0 ? "" : lines.filter(line => !isOfLog.test(line)).join("\n"),
    /** Of a compiled run: how it is built. */
    form: /^AOT test run \| ((?:one program|layers|programs without layers)\b.*)$/m.exec(stderr)?.[1],
    /** Of a compiled run: what the scan of its test files finds in all of them together. */
    scan: scan && {
      "test files": Number(scan[1]),
      "mocks any module": scan[2] === "true",
      "spies on objects from somewhere": scan[3] === "true",
    },
    /**
     * Of a compiled run: what the scan says of single test files, each line once and without the folder. It names a file that mocks a module or lets a
     * spy go out of sight.
     */
    outOfSight: [
      ...new Set(lines.flatMap(line => /^AOT test run \| \S*?([^\s\\/]+\.test\.[cm]js .+)$/.exec(line)?.[1] ?? [])),
    ].sort(),
  };
}
type Ran = Awaited<ReturnType<typeof runTests>>;

const commands = new Map<string, Promise<Ran>>();
/** One run for each command, however many tests ask for it. The first test that asks waits for the build. */
const ran = (together: string[], words?: string) =>
  commands.getOrInsertComputed(JSON.stringify([together, words]), () => runTests(together, words));

/** What a run says of one test file: the lines that the file prints, how its tests end, and what the scan holds against it. */
function saidOf({ stdout, report, outOfSight }: Ran, file: string) {
  const header = report.indexOf(`${file}:`);
  // Up to the next test file, or to the counts.
  const behind = report.findIndex((line, index) => index > header && !/^(?:\(|\w*Error: |error: )/.test(line));
  return {
    printed: stdout.split("\n").filter(line => line.startsWith(`SEEN ${file} `)),
    reported: header < 0 ? [] : report.slice(header + 1, behind < 0 ? undefined : behind),
    "out of sight, says the scan": outOfSight.filter(line => line.startsWith(`${file} `)),
  };
}

test("plain bun test runs the four test files, and each patches fetch and puts it back", async () => {
  const { stdout, stderr, exitCode } = await ran(testFiles);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    SEEN names.test.cjs function false
    SEEN names.test.cjs true
    SEEN member.test.cjs function false
    SEEN member.test.cjs true
    SEEN several.test.cjs function false
    SEEN several.test.cjs true
    SEEN meta.test.mjs function false
    SEEN meta.test.mjs true"
  `);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "names.test.cjs:
    (pass) a package patches fetch through a helper

    member.test.cjs:
    (pass) a package patches fetch through a helper

    several.test.cjs:
    (pass) d > a package patches fetch through a helper

    meta.test.mjs:
    (pass) a package patches fetch through a helper

     4 pass
     0 fail
    Ran 4 tests across 4 files."
  `);
  expect(exitCode).toBe(0);
});

for (const [title, { words, runs, form }] of Object.entries(forms)) {
  for (const together of runs) {
    // The test of a file reads what the run says of that file.
    test.each(together)(`%s: ${title}`, async file => {
      const plain = await ran(together);
      const compiled = await ran(together, words);
      expect(saidOf(plain, file)).toEqual({
        printed: [`SEEN ${file} function false`, `SEEN ${file} true`],
        reported: [`(pass) ${file === "several.test.cjs" ? "d > " : ""}a package patches fetch through a helper`],
        "out of sight, says the scan": [],
      });
      expect(saidOf(compiled, file)).toEqual(saidOf(plain, file));
    });

    test(`the run of ${together.join(", ")}: ${title}`, async () => {
      const plain = await ran(together);
      const { stdout, report, failure, exitCode, scan, outOfSight, form: built } = await ran(together, words);
      expect({ stdout, report, failure, exitCode, scan, outOfSight }).toEqual({
        stdout: plain.stdout,
        report: plain.report,
        failure: "",
        exitCode: 0,
        scan: { "test files": together.length, "mocks any module": false, "spies on objects from somewhere": false },
        outOfSight: [],
      });
      expect(built).toMatch(form(together.length));
    });
  }
}
