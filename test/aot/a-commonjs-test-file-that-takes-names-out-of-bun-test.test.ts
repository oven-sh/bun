// `const { test } = require("bun:test")` takes one name, as `import { test } from "bun:test"` does. A compiled test run read it as the whole object of bun:test
// going out of sight, `mock` and `spyOn` with it: every module of the run counted as mocked and every object as spied on. Flow then knew so little that a package
// which patches `fetch` through a helper was refused: "Cannot assign to fetch because built-in objects are read-only in compiled code". nock 15 loads that way.
import { expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// A test file names itself in the lines that it prints: a run may hold several of them. `load`: what the file loads the package with.
const body = (file: string, load = "require") => `("a package patches fetch through a helper", () => {
  const { activate } = ${load}("patches");
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
  "meta.test.mjs": `const { test } = import.meta.require("bun:test");\ntest${body("meta.test.mjs", "import.meta.require")}`,
  "variable.test.mjs": `const { test } = import.meta.require("bun:test");\nconst require = import.meta.require;\ntest${body("variable.test.mjs")}`,
};
const overLayers = ["names.test.cjs", "member.test.cjs", "several.test.cjs", "meta.test.mjs"];
const testFiles = [...overLayers, "variable.test.mjs"];

const noLayers = "this Bun loads one program a realm";
// A build is what costs, so the test files of a form share a run. What the scan finds in one file opens the whole run, so each test also reads what the scan
// says of its own file. `runs`: the test files of each run. variable.test.mjs holds its loader in a variable. Over layers that makes the lowest layer keep
// more of Bun's own code, and the programs above that layer differ with it. So that file runs as one program only, where it changes nothing for the others.
// a-test-file-names-a-node-builtin-with-the-bun-prefix.test.ts tests a loader under another name over layers. The four other files stand on the same
// layers, and `TestRunPartFiles:1` keeps each a program of its own above them. `form`: what a run of so many test files says of its build.
const forms = {
  "one program": {
    words: "TestRunLayers:0",
    runs: [testFiles],
    form: (count: number) => new RegExp(`^one program(: ${noLayers})? \\| test files ${count}$`),
  },
  "two layers": {
    words: "TestRunLayers:2,TestRunPartFiles:1",
    runs: [overLayers],
    form: (count: number) =>
      new RegExp(`^(layers 2|programs without layers: ${noLayers}) \\| test files ${count} \\| to a program 1( \\||$)`),
  },
};

// A compiled run writes the log of its builds between the lines of the runner: each test file, how its tests end, why one fails, and the counts.
const isOfReport =
  /^(?:\S+\.test\.[cm]js:|\((?:pass|fail|skip|todo)\) .*|(?:\w*Error|error): .*| *\d+ (?:pass|fail|skip|todo|errors?|expect\(\) calls)|Ran \d+ tests? across \d+ files?\..*)$/;
const isOfLog = /^(?:AOT |\s*\w+: wall )/;
const isScan =
  /^AOT test run \| scan of (\d+) files and \d+ beside them \| .*\| mocks any module (\w+) \| .*\| spies on objects from somewhere (\w+)$/gm;
// What the log says of one test file: its name stands behind its folder, which may hold a blank.
const isOfTestFile = new RegExp(
  `^AOT test run \\| (?:.*[\\\\/])?((?:${testFiles.join("|").replaceAll(".", "\\.")}) .+)$`,
);

/** `bun test` over test files together: compiled where `words` say in which form, plain without them. */
async function runTests(together: string[], words?: string) {
  using dir = tempDir("a-commonjs-test-file-that-takes-names-out-of-bun-test", files);
  const command = [bunExe(), "test", ...(words ? ["--aot"] : []), ...together.map(file => `./${file}`)];
  // The scan says what it finds in a file only with the log of the phases.
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: words ? "1" : undefined };
  const { stdout, stderr, exitCode } = await run(command, String(dir), env);
  const lines = stderr.split(/\r?\n/);
  const form = /^AOT test run \| ((?:one program|layers|programs without layers)\b.*)$/m.exec(stderr)?.[1];
  const scans = [...stderr.matchAll(isScan)].map(([, files, mocks, spies]) => ({
    files: Number(files),
    mocks: mocks !== "false",
    spies: spies !== "false",
  }));
  // The first scan is that of the run's test files. A run in parts without layers has none: each part is a whole program, and its build scans its own test file.
  const ofTestFiles = form?.startsWith("programs without layers") ? scans : scans.slice(0, 1);
  return {
    stdout,
    stderr,
    exitCode,
    /** What the runner says on stderr, without the times. */
    report: lines.filter(line => isOfReport.test(line)).map(line => line.replace(/ \[[\d.]+m?s\]$/, "")),
    /** Of a run that fails: what it says beside the log of its builds. */
    failure: exitCode === 0 ? "" : lines.filter(line => !isOfLog.test(line)).join("\n"),
    /** Of a compiled run: how it is built. */
    form,
    /** Of a compiled run: how many test files its scans read, and whether any scan of the run finds a mock or a spy that goes out of sight. */
    scan: scans.length > 0 && {
      "test files": ofTestFiles.reduce((count, scan) => count + scan.files, 0),
      "mocks any module": scans.some(scan => scan.mocks),
      "spies on objects from somewhere": scans.some(scan => scan.spies),
    },
    /**
     * Of a compiled run: what the scan says of single test files, each line once and without the folder. It names a file that mocks a module or lets a
     * spy go out of sight.
     */
    outOfSight: [...new Set(lines.flatMap(line => isOfTestFile.exec(line)?.[1] ?? []))].sort(),
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

test("plain bun test runs the five test files, and each patches fetch and puts it back", async () => {
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
    SEEN meta.test.mjs true
    SEEN variable.test.mjs function false
    SEEN variable.test.mjs true"
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

    variable.test.mjs:
    (pass) a package patches fetch through a helper

     5 pass
     0 fail
    Ran 5 tests across 5 files."
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
      expect({ failure: plain.failure, exitCode: plain.exitCode }).toEqual({ failure: "", exitCode: 0 });
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
