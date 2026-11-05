// `require("./m.cjs"); process.stderr.write("x\n")` in a test file. A file that is required may be taken out of require.cache and read again from disk, so the image of such a test run
// lets the library run from its text. The build had left the function that makes the whole stream out, because the program asks process.stderr for `write` alone. Native code took "its
// text may run" for "it was not left out", made the whole stream from the text, and that text called what else the build had left out:
// "'EventEmitter' was not compiled into this executable because your code never calls it".
import { expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `body`: the test of the case's test file. `stderr` and `stdout`: what that test writes there under plain `bun test`. No stream of a run is a terminal.
const cases: Record<string, { body: string; stderr: string[]; stdout?: string }> = {
  "a file is required": {
    body: `require("./m.cjs"); process.stderr.write("OUT written\\n");`,
    stderr: ["OUT written"],
  },
  "a name of it is read": {
    body: `const m = require("./m.cjs"); process.stderr.write("OUT written " + m.a + "\\n");`,
    stderr: ["OUT written first"],
  },
  "the other stream": {
    body: `const m = require("./m.cjs"); process.stdout.write("to the other stream\\n"); process.stderr.write("OUT written " + m.a + "\\n");`,
    stderr: ["OUT written first"],
    stdout: "to the other stream\n",
  },
  "its names are listed": {
    body: `process.stderr.write("OUT written " + Object.keys(require("./m.cjs")) + "\\n");`,
    stderr: ["OUT written a"],
  },
  "it is compared": {
    body: `expect(require("./m.cjs")).toEqual({ a: "first" }); process.stderr.write("OUT written\\n");`,
    stderr: ["OUT written"],
  },
  "by a require that was made": {
    body: `const made = createRequire(import.meta.url); process.stderr.write("OUT written " + made("./m.cjs").a + "\\n");`,
    stderr: ["OUT written first"],
  },
  "console.log is replaced by a write": {
    body: `const log = console.log; console.log = (...all) => process.stderr.write("OUT " + all.join(" ") + "\\n"); console.log(require("./m.cjs").a); console.log = log;`,
    stderr: ["OUT first"],
  },
  "what else the small streams answer": {
    body: `require("./m.cjs"); process.stderr.write("OUT " + [process.stderr.fd, process.stdout.fd, process.stdin.fd, typeof process.stderr.isTTY, typeof process.stdin.isTTY].join() + "\\n");`,
    stderr: ["OUT 2,1,0,undefined,undefined"],
  },
  "the file is taken out and read again": {
    body: `const first = require("./m.cjs"); delete require.cache[require.resolve("./m.cjs")]; process.stderr.write("OUT " + (require("./m.cjs") !== first) + "\\n");`,
    stderr: ["OUT true"],
  },
  "and the whole stream where it is asked for": {
    body: `require("./m.cjs"); process.stderr.once("drain", () => {}); process.stderr.write("OUT " + process.stderr.listenerCount("drain") + " " + typeof process.stderr.cork + "\\n");`,
    stderr: ["OUT 1 function"],
  },
};
const names = Object.keys(cases);
const storesToConsoleLog = "console.log is replaced by a write";
// In a project each case has a folder of its own, with its test file and the file that the test requires.
const folderOf = (name: string) => `c${String(names.indexOf(name) + 1).padStart(2, "0")}`;
const caseIn = Object.fromEntries(names.map(name => [folderOf(name), name]));

const noLayers = "this Bun loads one program a realm";
// A build is what costs, and the compiler sees the whole program: cases share a run only where none of them changes what the build makes of another.
// `runs`: the cases of each run. `words`: what makes the run take the form and say which it took. `built`: what a run of so many test files then says.
const forms = {
  // Here a test file is in one program with Bun's own code, and what it asks of a stream or of the required file changes the code of whatever else
  // the program holds. So every case is a run. Only here does the build leave the function that makes the whole stream out.
  "one program": {
    runs: names.map(name => [name]),
    words: "TestRunLayers:0",
    built: (count: number) => new RegExp(`^one program(: ${noLayers})? \\| test files ${count}$`),
  },
  // The lowest layer is Bun's own code, and it holds that function. The layer above it holds the files that the tests require, and
  // `TestRunPartFiles:1` keeps each test file a program of its own above both. The lowest layer is the same, byte for byte, for nine of the cases,
  // so those stand on one. The tenth stores to console.log: its lowest layer knows of the store, so it has a run of its own. These builds are the
  // longest. They come last, when the others have left them the processors.
  "two layers": {
    runs: [names.filter(name => name !== storesToConsoleLog), [storesToConsoleLog]],
    words: "TestRunLayers:2,TestRunPartFiles:1",
    built: (count: number) =>
      new RegExp(`^(layers 2|programs without layers: ${noLayers}) \\| test files ${count} \\| to a program 1( \\||$)`),
  },
};
type Form = keyof typeof forms;

/** `bun test --isolate` in a project of these cases: compiled in a form, plain without one. */
async function runTests(together: string[], form?: Form) {
  const files: Record<string, string> = {};
  for (const name of together) {
    files[`${folderOf(name)}/m.cjs`] = `exports.a = "first";\n`;
    files[`${folderOf(name)}/a.test.mjs`] =
      `import { test, expect } from "bun:test";\nimport { createRequire } from "node:module";\ntest("t", () => { ${cases[name].body} });\n`;
  }
  using dir = tempDir("aot-require-and-write", files);
  const command = [bunExe(), "test", ...(form ? ["--aot"] : []), "--isolate"];
  // With BUN_JSC_logAOTPhaseTimes a run logs its steps on stderr, and a run is held to every line of it.
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: form && forms[form].words, BUN_JSC_logAOTPhaseTimes: undefined };
  const { stdout, stderr, exitCode } = await run(command, String(dir), env);
  // Every line of stderr, without the times: under the case whose test file the runner names above it, or with what the run says of itself.
  const ofCases: Record<string, string[]> = {};
  const ofTheRun: string[] = [];
  let lines = ofTheRun;
  for (const line of normalizeBunSnapshot(stderr).split("\n")) {
    const folder = /^(c\d+)\/a\.test\.mjs:$/.exec(line)?.[1];
    if (folder) lines = ofCases[caseIn[folder] ?? folder] = [];
    else if (/^ *\d+ pass$/.test(line)) lines = ofTheRun;
    if (!folder && line) lines.push(line.trim());
  }
  const built = ofTheRun.findIndex(line => line.startsWith("AOT test run | "));
  return {
    stdout: stdout.replace(/^bun test .*\n/, ""),
    ofCases,
    /** Of a compiled run: how it is built. */
    built: built < 0 ? undefined : ofTheRun.splice(built, 1)[0].slice("AOT test run | ".length),
    ofTheRun,
    exitCode,
  };
}

/** What a run of these cases is held to: each test file writes what its case says and passes, and the run says nothing else. */
function expected(together: string[], form?: Form) {
  const count = together.length;
  const plural = count === 1 ? "" : "s";
  // The runner counts the calls of expect() in the test files, where there are any.
  const expectCalls = together.flatMap(name => cases[name].body.match(/\bexpect\(/g) ?? []).length;
  return {
    stdout: together.map(name => cases[name].stdout ?? "").join(""),
    ofCases: Object.fromEntries(together.map(name => [name, [...cases[name].stderr, "(pass) t"]])),
    built: form ? expect.stringMatching(forms[form].built(count)) : undefined,
    ofTheRun: [
      `${count} pass`,
      "0 fail",
      ...(expectCalls ? [`${expectCalls} expect() calls`] : []),
      `Ran ${count} test${plural} across ${count} file${plural}.`,
    ],
    exitCode: 0,
  };
}

for (const form of Object.keys(forms) as Form[]) {
  const titled = forms[form].runs.map(
    together => [together.length === 1 ? together[0] : `${together.length} cases in one run`, together] as const,
  );
  test.concurrent.each(titled)(`%s: ${form}`, async (_, together) => {
    expect(await runTests(together)).toEqual(expected(together));
    expect(await runTests(together, form)).toEqual(expected(together, form));
  });
}
