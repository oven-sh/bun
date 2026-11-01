// Inside a require() an async factory that awaits is not called, and the real module answers. One that awaits nothing itself settles during the call.
// Plain Bun asks the parser which of the two a factory is. A compiled factory has no executable, so the build says it, with or without the text of functions.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

// Which functions hold an `await` of their own is the front end's to say: test/aot/ir/lower/programs/async/own-await.ts. Here: that the host asks it.
const awaits = {
  "an await": `async () => { await x; return made; }`,
  "an async generator, with or without one": `async function* () { yield made; }`,
};
const awaitsNothing = {
  "the word in a comment, a string and an inner function": `async () => ({ /* await */ ...made, text: "await", inner: async () => await x })`,
};

const body = (forms: Record<string, string>, folder: string, name: string) => `
const x = Promise.resolve(1), made = { platform: () => "mock" };
const forms = { ${Object.entries(forms).map(([name, factory]) => `${JSON.stringify(name)}: ${factory}`)} };
const path = ${folder} + "/${name}.cjs";
writeFileSync(path, 'module.exports = () => require("node:os").platform();');
test("what code from disk requires", () => {
  const ask = require(path);
  for (const [name, factory] of Object.entries(forms)) {
    mock.module("node:os", factory);
    console.log("OUT", name + ":", ask() === "mock" ? "mock" : "real");
  }
});`;
const files = {
  "package.json": `{ "name": "mock-factory-awaits", "type": "module" }`,
  "a.test.mjs": `import { mock, test } from "bun:test";
import { writeFileSync } from "node:fs";${body({ ...awaits, ...awaitsNothing }, "import.meta.dir", "from-module")}`,
  "c.test.mjs": `import { test } from "bun:test";
test("the next file", () => console.log("OUT the next file:", require("node:os").platform() === process.platform ? "real" : "mock"));`,
};
const expected = [
  ...Object.keys(awaits).map(name => `OUT ${name}: real`),
  ...Object.keys(awaitsNothing).map(name => `OUT ${name}: mock`),
  "OUT the next file: real",
];

async function run(dir: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test.concurrent.each([
  ["plain", [], ""],
  ["as one program", ["--aot"], "TestRunLayers:0"],
  ["over two layers", ["--aot"], "TestRunLayers:2"],
  ["without the text of functions", ["--aot"], "TestRunLayers:0,TestRunWithoutFunctionSource"],
] as const)(
  "%s",
  async (_, flags, words) => {
    using folder = tempDir("aot-mock-factory-awaits", files);
    expect(await run(String(folder), [...flags], words)).toEqual({ lines: expected, exitCode: 0 });
  },
  240_000,
);
