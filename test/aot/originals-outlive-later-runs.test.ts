import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const actual = `console.log("SAID actual", (await vi.importActual("./lib.cjs")).value);`;
const imported = `console.log("SAID imported", (await import("./lib.cjs")).value);`;
const mocked = `vi.doMock("./lib.cjs", () => ({ value: "mock" }));`;
const partlyMocked = `vi.doMock("./lib.cjs", async original => ({ ...(await original()), more: 1 }));`;

test.each([
  [
    "a later test file imported the file",
    [actual + mocked, imported, mocked + actual],
    ["actual 1", "imported 2", "actual 1"],
  ],
  [
    "a later test file imported the file, and a mock asks for the original",
    [actual + mocked, imported, partlyMocked + imported],
    ["actual 1", "imported 2", "imported 1"],
  ],
  [
    "a later test file mocked the file by mock.module()",
    [actual + mocked, imported + `mock.module("./lib.cjs", () => ({ value: "other" }));`, mocked + actual],
    ["actual 1", "imported 2", "actual 1"],
  ],
  [
    "one mock replaces another",
    [actual + mocked, imported, partlyMocked + imported + mocked + actual],
    ["actual 1", "imported 2", "imported 1", "actual 1"],
  ],
  [
    "the program deletes from require.cache",
    [
      actual +
        mocked +
        `vi.doUnmock("./lib.cjs");` +
        partlyMocked +
        imported +
        `if (globalThis.never) delete require.cache[require.resolve("./lib.cjs")];`,
    ],
    ["actual 1", "imported 1"],
  ],
] as const)("the run that vi.importActual() gave stays the original where %s", async (_, bodies, values) => {
  const files = bodies.map((body, index) => [
    `${index}.test.mjs`,
    `import { mock, test, vi } from "bun:test";\nimport { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\ntest("t", async () => {\n${body}\n});`,
  ]);
  using directory = tempDir("originals-outlive-later-runs", {
    "package.json": `{ "name": "p" }`,
    "lib.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexports.value = globalThis.runs;`,
    ...Object.fromEntries(files),
  });
  const names = files.map(([name]) => `./${name}`);
  const plain = await run([bunExe(), "test", ...names], String(directory), bunEnv);
  const { stdout, stderr } = await run([bunExe(), "test", "--aot", ...names], String(directory), bunEnv);
  const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID "));
  expect(said(plain.stdout)).toEqual(values.map(value => `SAID ${value}`));
  expect(said(stdout)).toEqual(said(plain.stdout));
  expect(stdout + stderr).toContain(` ${names.length} pass`);
});
