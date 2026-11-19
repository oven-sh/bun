import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A CommonJS file that a require() alone has loaded; mock.module() over it has called its factory, which has yet to settle.
const projectOf = (testFile: string, more: Record<string, string> = {}) => ({
  "package.json": `{ "name": "made-up", "private": true }\n`,
  "ledger.cjs": `globalThis.turns = (globalThis.turns ?? 0) + 1;\nexports.kind = "real";\n`,
  "a_test.mjs": `import { mock, test } from "bun:test";\n${testFile}`,
  ...more,
});

async function linesOf(project: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("aot-a-written-import-of-a-file-that-was-only-required", project);
  const { stdout } = await run([bunExe(), "test", ...flags, "./a_test.mjs"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  return stdout.split("\n").filter(line => line.startsWith("SAID"));
}

test.failing(
  "a written require() meanwhile: it prints what bun test prints: a wrong answer today: under `bun test --aot` it gets the module that is loaded, where `bun test` runs the original a second time",
  async () => {
    const project = projectOf(`test("one", async () => {
  const required = require("./ledger.cjs");
  const laid = mock.module("./ledger.cjs", async () => { await 0; return { kind: "mocked" }; });
  const again = require("./ledger.cjs");
  console.log("SAID meanwhile", again.kind, again === required, globalThis.turns);
  await laid;
  console.log("SAID behind", require("./ledger.cjs").kind, globalThis.turns);
});
`);
    const plain = await linesOf(project);
    expect(plain).toEqual(["SAID meanwhile real false 2", "SAID behind mocked 2"]);
    expect(await linesOf(project, "--aot")).toEqual(plain);
  },
);

test.failing(
  "another file makes the written import: it prints what bun test prints: a wrong answer today: under `bun test --aot` it gets the module that is loaded, patched, where `bun test` waits for the factory and gives the mock",
  async () => {
    const project = projectOf(
      `import { ask } from "./asker.mjs";
test("one", async () => {
  const required = require("./ledger.cjs");
  mock.module("./ledger.cjs", async () => { await 0; return { kind: "mocked" }; });
  const asked = await ask();
  console.log("SAID meanwhile", asked.kind, asked.default === required, globalThis.turns);
});
`,
      { "asker.mjs": `export const ask = () => import("./ledger.cjs");\n` },
    );
    const plain = await linesOf(project);
    expect(plain).toEqual(["SAID meanwhile mocked false 1"]);
    expect(await linesOf(project, "--aot")).toEqual(plain);
  },
);

test.failing(
  "the factory is a plain arrow that returns a promise: it prints what bun test prints: a wrong answer today: under `bun test --aot` it gets the module that is loaded, patched: the build takes only an async factory for one that may stay pending",
  async () => {
    const project = projectOf(`test("one", async () => {
  const required = require("./ledger.cjs");
  mock.module("./ledger.cjs", () => Promise.resolve().then(() => ({ kind: "mocked" })));
  const asked = await import("./ledger.cjs");
  console.log("SAID meanwhile", asked.kind, asked.default === required, globalThis.turns);
});
`);
    const plain = await linesOf(project);
    expect(plain).toEqual(["SAID meanwhile real false 2"]);
    expect(await linesOf(project, "--aot")).toEqual(plain);
  },
);
