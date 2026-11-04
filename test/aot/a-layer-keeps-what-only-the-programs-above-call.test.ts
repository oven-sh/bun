// A run of many test files is compiled as several programs: the packages, the rest of what the tests import, the test files. The build of a lower program
// does not see the programs above it, which call what it exports. Here `load` is called by the test file alone, and the package behind the file that it
// loads is reached by nothing else. Flow once let go of such an export where its rules ran in one of the orders that are as good as the usual one:
// "'load' was not compiled into this executable because your code never calls it".
import { afterEach, beforeEach, expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, normalizeBunSnapshot, tempDir } from "harness";
import { availableParallelism } from "node:os";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { memoryLimitOfCommandsAtOnce } from "./harness/memory-limit";
import { run } from "./harness/run";
import { test as oneAtATime } from "./supported";

raiseDefaultTimeout(120_000);

// Each test is one run of `bun test` in a folder of its own, and the tests run at once. An order of flow's rules is an option of the compiler, so every
// run over layers compiles Bun's own code for itself: that is nearly all that it costs, and it keeps three of four processors busy, or five of twelve.
// So a quarter as many tests as the machine has processors are under way, two at least. More of them take the processors from the files that CI runs
// beside this one, and each test then takes longer. Nor are more under way than the memory for the commands of a file has room for. There a run counts
// as half a gigabyte, and as two where the Bun under test has a sanitizer or assertions: it was seen to hold 0.2 and 1.7. A test waits for its turn in
// a hook, which has no limit, so the limit of a test is for its own run.
const test = oneAtATime.concurrent;
const roomFor = Math.floor(memoryLimitOfCommandsAtOnce / ((isASAN || isDebug ? 2 : 0.5) * 2 ** 30));
let free = Math.max(1, Math.min(Math.max(2, availableParallelism() >> 2), roomFor));
const waiting: (() => void)[] = [];
beforeEach(() => (free > 0 ? void free-- : new Promise<void>(resolve => waiting.push(resolve))), 0);
afterEach(() => {
  const next = waiting.shift();
  if (next) next();
  else free++;
});

// A run whose words ask for layers says first how it is built. What stands around these two numbers differs from one build of Bun to another.
const form = /^AOT test run \| .*?\| (test files \d+ \| to a program \d+).*\n/m;

/**
 * What `bun test <flags>` says in a folder that holds `files`, and how it ends: its stdout behind the line that names Bun, and every line of its stderr
 * without the times, but for the source that a failure quotes and the frames of its stack, of which a debug build of Bun lists more. With --parallel a
 * test file runs in a worker, and its results and what it prints reach the run by two pipes: the lines stand under their test file, in the order of the
 * alphabet.
 */
async function printed(files: Record<string, string>, flags: string[], words?: string) {
  using dir = tempDir("a-layer-keeps-what-only-the-programs-above-call", files);
  // Whoever runs this file may have a build log its phases, which is thousands of lines. No run here takes that, nor any words, from the environment.
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: undefined };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
  const said: Record<string, string[]> = { "above the files": [] };
  let about = said["above the files"];
  for (const whole of normalizeBunSnapshot(stderr.replace(form, ""), String(dir)).split("\n")) {
    const line = whole.trim();
    if (!line || /^(\d+ \| |\^$|at )/.test(line)) continue;
    if (/\.test\.\w+:$/.test(line)) about = said[line.slice(0, -1)] ??= [];
    else if (/^\d+ pass$/.test(line)) about = said["in all"] = [line];
    else about.push(line);
  }
  for (const [name, lines] of Object.entries(said)) if (name.includes(".test.")) lines.sort();
  return {
    stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test v")),
    stderr: said,
    built: form.exec(stderr)?.[1],
    exitCode,
  };
}

const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "node_modules/one-pkg/package.json": `{ "name": "one-pkg", "version": "1.0.0", "type": "module", "main": "index.js" }`,
  "node_modules/one-pkg/index.js": `export const one = x => "one<" + x;`,
  "node_modules/two-pkg/package.json": `{ "name": "two-pkg", "version": "1.0.0", "type": "module", "main": "index.js" }`,
  "node_modules/two-pkg/index.js": `export default function f(x) { return "f(" + x + ")"; }`,
  "src/direct.js": `import { one } from "one-pkg";\nexport const direct = one("d");`,
  "src/late.js": `import f from "two-pkg";\nexport const made = f("late");`,
  "src/loads.js": `export const load = () => import("./late.js");`,
  "a.test.js": `
    import { test } from "bun:test";
    import { direct } from "./src/direct.js";
    import { load } from "./src/loads.js";
    test("a", async () => {
      let said;
      try { said = (await load()).made; } catch (error) { said = "THREW " + String(error.message).slice(0, 90); }
      console.log("SEEN", JSON.stringify([direct, said]));
    });`,
};
const flags = ["--isolate", "--parallel=2"];
// What plain Bun says of the project, and so every run over layers.
const says = {
  stdout: [`SEEN ["one<d","f(late)"]`],
  stderr: {
    "above the files": [],
    "a.test.js": ["(pass) a"],
    "in all": ["1 pass", "0 fail", "Ran 1 test across 1 file."],
  },
  exitCode: 0,
};

// Plain Bun compiles nothing, so no order reaches it: it runs the project once, for all of them.
test("an export that only the test file calls, in plain Bun", async () => {
  expect(await printed(files, flags)).toEqual({ ...says, built: undefined });
});

const orders = [
  "",
  "testing=DelayOtherFlowRules",
  "testing=DelayFlowRules",
  "testing=DelayFlowRules:7",
  "testing=DelayFlowRules:200",
];

test.each(orders)(
  "an export that only the test file calls, over two layers: the order of flow's rules %j",
  async order => {
    const words = ["TestRunLayers:2", "TestRunPartFiles:1", order].filter(Boolean).join(",");
    // run() fails a run that asks for two layers and is not built so. The test file is a program of its own above them.
    const built = "test files 1 | to a program 1";
    expect(await printed(files, ["--aot", ...flags], words)).toEqual({ ...says, built });
  },
);

// What a reducer left of a generated project. Two test files of one program name no helper in an import statement, and they alone call what they load under a
// computed name. Tidier forms did not show the fault, so the text stays as it was found: its tests fail in plain Bun too. What counts is where the first of
// them fails: behind its call of `add`, the export that is called by the test files alone.
const reduced = {
  "setup.ts": "",
  "helpers/math.ts": `export function add(a: number, b: number): number { return a + b; }`,
  "file0.test.tsx": `const note = (label: string, ...values: unknown[]) => { seen.push(label + ": " + joinOf.call(mapOf.call(values, show), " ")); };
test.if(true)("an import under a computed name 0", async () => {
  const name = ["ma", "th"].join(""); const loaded: any = await import("./helpers/" + name + ".ts"); note("imported", loaded.add(7, 1), loaded.default(2));
});`,
  "file1.test.mts": `const store = (path: any, text: any) => require("node:fs").writeFileSync(path, text), asText = JSON.stringify, isList = Array.isArray, joinOf = Array.prototype.join, mapOf = Array.prototype.map;
afterAll(async () => { for (const ask of leftReplaced) { try { note("left replaced", ask()); } catch (error) { note("left replaced", error); } } await store(process.env.SEEN_IN + "/file1.test.mts.json", asText(seen, null, 1)); });
describe("a group", () => {
test("an import under a computed name 2", async () => {
  for (const each of ["state.js", "counters.ts", "missing.js"]) { try { note(each, Object.keys(await import(\`./helpers/\${each}\`)).sort().join()); } catch (error: any) { note(each, error.name); } }
});
});`,
};
const flagsOfReduced = ["--isolate", "--parallel=4", "--preload", "./setup.ts"];
// The test without a name is the `afterAll` of the second file.
const saysOfReduced = {
  stdout: [],
  stderr: {
    "above the files": [],
    "file0.test.tsx": [
      "(fail) an import under a computed name 0",
      "TypeError: loaded.default is not a function. (In 'loaded.default(2)', 'loaded.default' is undefined)",
    ],
    "file1.test.mts": [
      "(fail) (unnamed)",
      "(fail) a group > an import under a computed name 2",
      "ReferenceError: leftReplaced is not defined",
      "ReferenceError: note is not defined",
    ],
    "in all": ["0 pass", "3 fail", "Ran 3 tests across 2 files."],
  },
  exitCode: 1,
};

test("an export behind a computed name, in plain Bun", async () => {
  expect(await printed(reduced, flagsOfReduced)).toEqual({ ...saysOfReduced, built: undefined });
});

test.each(["", "testing=DelayFlowRules:3", "testing=DelayOtherFlowRules"])(
  "an export behind a computed name, two test files to a program: the order of flow's rules %j",
  async order => {
    const words = ["TestRunLayers:2", "TestRunPartFiles:2", order].filter(Boolean).join(",");
    const built = "test files 2 | to a program 2";
    expect(await printed(reduced, ["--aot", ...flagsOfReduced], words)).toEqual({ ...saysOfReduced, built });
  },
);
