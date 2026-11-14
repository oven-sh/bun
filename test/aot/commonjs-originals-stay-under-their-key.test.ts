import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const mocks = {
  "vi.doMock()": `vi.doMock("./lib.cjs", () => ({ value: "mock" }));`,
  "vi.doMock() with a factory that awaits": `vi.doMock("./lib.cjs", async () => { await 0; return { value: "mock" }; });`,
  "vi.doMock() that spies": `vi.doMock("./lib.cjs", { spy: true });`,
  "vi.doMock() and vi.doUnmock()": `vi.doMock("./lib.cjs", () => ({ value: "mock" }));\n  vi.doUnmock("./lib.cjs");`,
};

test.each(Object.entries(mocks))(
  "a CommonJS file that vi.importActual() loaded in front of %s is the original in the next test file too",
  async (_, steps) => {
    const testFile = (before: string) => `import { test, vi } from "bun:test";
test("t", async () => {
  ${before}
  console.log("SAID original", (await vi.importActual("./lib.cjs")).value);
  ${before ? `console.log("SAID file", (await import("./lib.cjs")).value);` : steps}
});`;
    using directory = tempDir("commonjs-originals-stay-under-their-key", {
      "package.json": `{ "name": "p" }`,
      "dep.cjs": `exports.value = "dep";`,
      "lib.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexports.value = require("./dep.cjs").value + " " + globalThis.runs;`,
      "a.test.mjs": testFile(""),
      "b.test.mjs": testFile(`vi.doMock("./lib.cjs", () => ({ value: "mock" }));`),
    });
    const files = ["./a.test.mjs", "./b.test.mjs"];
    const plain = await run([bunExe(), "test", ...files], String(directory), bunEnv);
    const { stdout, stderr } = await run([bunExe(), "test", "--aot", ...files], String(directory), bunEnv);
    const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID "));
    expect(said(plain.stdout)).toEqual(["SAID original dep 1", "SAID original dep 1", "SAID file mock"]);
    expect(said(stdout)).toEqual(said(plain.stdout));
    expect(stdout + stderr).toContain(" 2 pass");
  },
);

test("a CommonJS file that vi.importActual() loaded runs once more behind the end of its mock", async () => {
  using directory = tempDir("commonjs-originals-stay-under-their-key", {
    "package.json": `{ "name": "p" }`,
    "lib.cjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexports.value = globalThis.runs;`,
    "a.test.mjs": `import { test, vi } from "bun:test";
import { createRequire } from "node:module";
test("t", async () => {
  console.log("SAID original", (await vi.importActual("./lib.cjs")).value);
  vi.doMock("./lib.cjs", () => ({ value: "mock" }));
  vi.doUnmock("./lib.cjs");
  console.log("SAID file", createRequire(import.meta.url)("./lib.cjs").value, (await import("./lib.cjs")).value);
});`,
  });
  const plain = await run([bunExe(), "test", "./a.test.mjs"], String(directory), bunEnv);
  const { stdout, stderr } = await run([bunExe(), "test", "--aot", "./a.test.mjs"], String(directory), bunEnv);
  const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID "));
  expect(said(plain.stdout)).toEqual(["SAID original 1", "SAID file 2 2"]);
  expect(said(stdout)).toEqual(said(plain.stdout));
  expect(stdout + stderr).toContain(" 1 pass");
});
