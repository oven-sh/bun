import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { isHardened } from "./hardened";
import { run } from "./harness/run";
import { test as testWhereSupported } from "./supported";

// A hardened Bun runs only what was compiled.
const test = testWhereSupported.skipIf(isHardened);

// graph.import() runs a file from its text, each graph its own copy. No import() or require() of the program has a name that the build does not know, so the graph alone
// says that code comes from the disk: a file that the program holds too, one that such a file imports, a CommonJS file, and a file that is written while the program runs.
const program = (start: string, firstLineOfMade: string) => `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bump } from "./src/state";
import { bump as bumpOld } from "./src/old.cjs";
const ask = async (label: string, answer: () => unknown) => {
  try { console.log("SAID", label, await answer()); }
  catch (error: any) { console.log("SAID", label, "THROWS", error.code); }
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
const said = (output: string) => output.split("\n").filter(line => line.startsWith("SAID"));
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

test("in a test run, as one program and in two layers", async () => {
  using dir = tempDir("aot-module-graph-loads-files", files);
  const directory = String(dir);
  const ask = async (flags: string[], words: string) => {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_TMPDIR: directory };
    const ran = await run([bunExe(), "test", ...flags, "./a.test.ts"], directory, env);
    return said(ran.stdout + "\n" + ran.stderr);
  };
  expect(await ask([], "")).toEqual(expected);
  expect(await ask(["--aot"], "")).toEqual(expected);
  expect(await ask(["--aot", "--isolate"], "TestRunLayers:0")).toEqual(expected);
  expect(await ask(["--aot", "--isolate"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(expected);
});

test("in an executable that stays beside its files", async () => {
  using dir = tempDir("aot-module-graph-loads-files-in-place", files);
  const directory = String(dir);
  expect(said((await run([bunExe(), "main.ts"], directory)).stdout)).toEqual(expected);
  const outfile = join(directory, "program");
  const flags = ["--compile", "--aot", "--compile-in-place", "--aot-allow-code-from-disk"];
  const built = await run([bunExe(), "build", ...flags, "main.ts", "--outfile", outfile], directory);
  expect(built.exitCode).toBe(0);
  expect(said((await run([outfile], directory)).stdout)).toEqual(expected);
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
  const refused = "THROWS ERR_MODULE_NOT_FOUND";
  const filesOfProgramAreRefused = [
    expected[0],
    "SAID a file that the program holds " + refused,
    "SAID the same file once more " + refused,
    "SAID a CommonJS file that the program holds " + refused,
  ];
  expect((await build("--aot-allow-code-from-disk")).exitCode).toBe(0);
  expect(said((await run([outfile], directory)).stdout)).toEqual([
    ...filesOfProgramAreRefused,
    "SAID a file that was just written none made",
    "SAID in a second graph none made",
    expected[6],
    expected[7],
  ]);
  // Without the flag no code comes from the disk.
  expect((await build()).exitCode).toBe(0);
  expect(said((await run([outfile], directory)).stdout)).toEqual([
    ...filesOfProgramAreRefused,
    "SAID a file that was just written " + refused,
    "SAID in a second graph " + refused,
    "SAID what the files left on the global object undefined",
    expected[7],
  ]);
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
  catch (error: any) { console.log("SAID THROWS", error.code); }
});
`,
  });
  const directory = String(dir);
  const ask = async (...flags: string[]) => {
    const ran = await run([bunExe(), "test", ...flags, "./a.test.ts"], directory, { ...bunEnv, BUN_TMPDIR: directory });
    return said(ran.stdout + "\n" + ran.stderr);
  };
  expect(await ask()).toEqual(["SAID 42"]);
  expect(await ask("--aot")).toEqual(["SAID 42"]);
});
