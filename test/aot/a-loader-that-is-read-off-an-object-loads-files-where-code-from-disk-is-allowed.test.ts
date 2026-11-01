import { expect, type AsymmetricMatcher } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { join } from "node:path";
import { isHardened } from "./hardened";
import { built } from "./harness/commands";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test as testWhereSupported } from "./supported";

// A hardened Bun runs only what was compiled. No test waits for more than one build that holds all of Bun's own code, and they run side by side.
const test = testWhereSupported.concurrent.skipIf(isHardened);
// A debug build of Bun takes four to seven minutes for one of these builds by itself: more than the harness gives a test of it.
if (isDebug) raiseDefaultTimeout(1_800_000);

// graph.import() runs a file from its text, each graph its own copy. No import() or require() of the program has a name that the build does not know, so the graph alone
// says that code comes from the disk: a file that the program holds too, one that such a file imports, a CommonJS file, and a file that is written while the program runs.
const program = (start: string, firstLineOfMade: string) => `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bump } from "./src/state";
import { bump as bumpOld } from "./src/old.cjs";
const ask = async (label: string, answer: () => unknown) => {
  try { console.log("SAID", label, await answer()); }
  catch (error: any) { console.log("SAID", label, "THROWS", error.code, error.message); }
};
const run = async () => {
  const state = require.resolve("./src/state");
  const old = require.resolve("./src/old.cjs");
  const graph = new Bun.ModuleGraph({});
  await ask("the program's own", () => [bump(), bump(), bumpOld()].join());
  await ask("a file that the program holds", async () => (await graph.import(state)).bump());
  await ask("the same file once more", async () => (await graph.import(state)).bump());
  await ask("a CommonJS file that the program holds", async () => (await graph.import(old)).default.bump());
  const made = join(mkdtempSync(join(tmpdir(), "graph-")), "made.mjs");
  writeFileSync(made, ${firstLineOfMade} + "globalThis.seenByGraph = (globalThis.seenByGraph ?? 0) + 1;\\nexport const said = () => bump() + ' made';\\n");
  await ask("a file that was just written", async () => (await graph.import(made)).said());
  const second = new Bun.ModuleGraph({ globals: { tag: "second" } });
  await ask("in a second graph", async () => (await second.import(made)).said());
  await ask("what the files left on the global object", () => (globalThis as any).seenByGraph);
  await ask("the program's own, afterwards", () => [bump(), bumpOld()].join());
  graph.dispose();
  second.dispose();
};
${start}
`;
const importsState = `"import { bump } from " + JSON.stringify(state) + ";\\n"`;
const files = {
  "tsconfig.json": "{}",
  "package.json": `{ "name": "graphs", "type": "module" }`,
  "src/state.ts": `import { step } from "./step";\nlet count = 0;\nexport const bump = (): string => "state " + (count += step);\n`,
  "src/step.ts": `export const step: number = 1;\n`,
  "src/old.cjs": `let count = 0;\nexports.bump = () => "old " + ++count;\n`,
  "a.test.ts": `import { test } from "bun:test";\n` + program(`test("graphs", run);`, importsState),
  "main.ts": program(`await run();`, importsState),
};
// Of a refusal the file and the reason stay: its folders differ from run to run, and what it advises is for other tests.
const said = (output: string) =>
  output
    .split("\n")
    .filter(line => line.startsWith("SAID"))
    .map(line => line.replace(/ Cannot load '[^']*?([^'\\/]+)': (.+?\.)(?= |$).*$/, " Cannot load '$1': $2"));
const expected = [
  "SAID the program's own state 1,state 2,old 1",
  "SAID a file that the program holds state 1",
  "SAID the same file once more state 2",
  "SAID a CommonJS file that the program holds old 1",
  "SAID a file that was just written state 3 made",
  "SAID in a second graph state 1 made",
  "SAID what the files left on the global object 2",
  "SAID the program's own, afterwards state 3,old 2",
];

type Output = Awaited<ReturnType<typeof run>>;

/** `bun test <flags> ./a.test.ts` in the folder. */
const testRun = (directory: string, flags: string[], words = "") =>
  run([bunExe(), "test", ...flags, "./a.test.ts"], directory, {
    ...bunEnv,
    BUN_DEBUG_TEST_AOT_WORDS: words,
    BUN_TMPDIR: directory,
  });
/** What the test file said, and what the run made of its tests. */
const reported = ({ stdout, stderr, exitCode }: Output) => ({
  said: said(stdout + "\n" + stderr),
  results: [...stderr.matchAll(/^\((pass|fail|skip|todo)\) (.*?)(?: \[.*\])?$/gm)].map(
    match => `${match[1]} ${match[2]}`,
  ),
  ran: stderr.match(/^Ran \d+ tests? across \d+ files?/m)?.[0],
  exitCode,
});
const passed = (lines: string[], name: string) => ({
  said: lines,
  results: [`pass ${name}`],
  ran: "Ran 1 test across 1 file",
  exitCode: 0,
});

// How a compiled run says that it is built, where a word asks it to. A Bun that loads one program a realm has no layers.
const oneProgram = expect.stringMatching(/^AOT test run \| one program\b.* \| test files 1$/);
const twoLayers = expect.stringMatching(/^AOT test run \| (layers 2|programs without layers)\b.* \| test files 1 \| /);
const testRuns: [name: string, flags: string[], words: string, form: AsymmetricMatcher | undefined][] = [
  ["without --aot", [], "", undefined],
  // The word changes nothing: with it a compiled run says how it is built.
  ["with --aot, as one program", ["--aot"], "TestRunSaysItsForm", oneProgram],
  ["with --aot --isolate, as one program", ["--aot", "--isolate"], "TestRunLayers:0", oneProgram],
  ["with --aot --isolate, in two layers", ["--aot", "--isolate"], "TestRunLayers:2,TestRunPartFiles:1", twoLayers],
];
test.each(testRuns)("in a test run %s", async (_, flags, words, form) => {
  using dir = tempDir("aot-module-graph-loads-files", files);
  const ran = await testRun(String(dir), flags, words);
  expect({ ...reported(ran), form: ran.stderr.match(/^AOT test run \| .*$/m)?.[0] }).toEqual({
    ...passed(expected, "graphs"),
    form,
  });
});

/** What a program said, what it wrote beside that, and how it ended. */
const ended = ({ stdout, stderr, exitCode }: Output) => ({ said: said(stdout), stderr, exitCode });
const endedWell = (lines: string[]) => ({ said: lines, stderr: "", exitCode: 0 });

test("in an executable that stays beside its files", async () => {
  using dir = tempDir("aot-module-graph-loads-files-in-place", files);
  const directory = String(dir);
  expect(ended(await run([bunExe(), "main.ts"], directory))).toEqual(endedWell(expected));
  const outfile = join(directory, "program");
  const flags = ["--compile", "--aot", "--compile-in-place", "--aot-allow-code-from-disk"];
  built(await run([bunExe(), "build", ...flags, "main.ts", "--outfile", outfile], directory));
  expect(ended(await run([outfile], directory))).toEqual(endedWell(expected));
});

// It does not hold the text of what it has compiled, and says so. Every other file loads.
test("in an executable that holds its files", async () => {
  using dir = tempDir("aot-module-graph-loads-files-from-disk", {
    ...files,
    "main.ts": program(`await run();`, `"const bump = () => 'none';\\n"`),
  });
  const directory = String(dir);
  const outfile = join(directory, "program");
  const build = (...flags: string[]) =>
    run([bunExe(), "build", "--compile", "--aot", ...flags, "main.ts", "--outfile", outfile], directory);
  const refused = (file: string, why: string) => `THROWS ERR_MODULE_NOT_FOUND Cannot load '${file}': ${why}`;
  const isCompiled =
    "it's compiled into this executable, and a compiled module can't be loaded a second time (for example into a Bun.ModuleGraph).";
  const filesOfProgramAreRefused = [
    expected[0],
    "SAID a file that the program holds " + refused("state.ts", isCompiled),
    "SAID the same file once more " + refused("state.ts", isCompiled),
    "SAID a CommonJS file that the program holds " + refused("old.cjs", isCompiled),
  ];
  built(await build("--aot-allow-code-from-disk"));
  expect(ended(await run([outfile], directory))).toEqual(
    endedWell([
      ...filesOfProgramAreRefused,
      "SAID a file that was just written none made",
      "SAID in a second graph none made",
      expected[6],
      expected[7],
    ]),
  );
  // Without the flag no code comes from the disk.
  const isOutside = "it isn't in this executable, which only runs code that was compiled into it.";
  built(await build());
  expect(ended(await run([outfile], directory))).toEqual(
    endedWell([
      ...filesOfProgramAreRefused,
      "SAID a file that was just written " + refused("made.mjs", isOutside),
      "SAID in a second graph " + refused("made.mjs", isOutside),
      "SAID what the files left on the global object undefined",
      expected[7],
    ]),
  );
});

// The handlers of require.extensions load the file that they are handed, and nothing else of these programs loads by a name that the build does not know.
test.each([
  ["require.extensions", `require.extensions`],
  ["Module._extensions", `(Module as any)._extensions`],
  ["the extensions of a require that createRequire() has made", `Module.createRequire(import.meta.url).extensions`],
])("%s loads a file that a test has just written", async (_, extensions) => {
  using dir = tempDir("aot-extension-handlers-load-files", {
    "tsconfig.json": "{}",
    "a.test.ts": `import { test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("a handler", () => {
  const made = join(mkdtempSync(join(tmpdir(), "handler-")), "made.js");
  writeFileSync(made, "module.exports = 42;\\n");
  const loaded: any = new Module(made);
  try { ${extensions}[".js"](loaded, made); console.log("SAID", loaded.exports); }
  catch (error: any) { console.log("SAID THROWS", error.code, error.message); }
});
`,
  });
  const directory = String(dir);
  const loaded = passed(["SAID 42"], "a handler");
  expect(reported(await testRun(directory, []))).toEqual(loaded);
  expect(reported(await testRun(directory, ["--aot"]))).toEqual(loaded);
});
