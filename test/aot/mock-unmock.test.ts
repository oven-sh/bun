import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// vi.doUnmock() and jest.dontMock() end a mock. A file that was mocked ahead of its load has not run: the next require() or import() runs its body and answers the real module.
const testFile = (from: string, unmock: string) => `
import { test, mock, ${from} } from "bun:test";
const said = async (label, ask) => { try { console.error("SEEN", label, "|", await ask()); } catch (error) { console.error("SEEN", label, "| threw", error.name, error.message.slice(0, 70)); } };
test("ended before any load", async () => {
  mock.module("./src/c1.cjs", () => ({ c: () => "mocked c" }));
  ${unmock}("./src/c1.cjs");
  await said("a CommonJS file", () => require("./src/c1.cjs").c());
  mock.module("./src/m1.js", () => ({ v: "mocked v" }));
  ${unmock}("./src/m1.js");
  await said("an ES module", async () => (await import("./src/m1.js")).v);
  mock.module("node:os", () => ({ platform: () => "mocked os" }));
  ${unmock}("node:os");
  await said("a built-in module", () => require("node:os").platform() === "mocked os");
});
test("ended behind a load", async () => {
  mock.module("./src/c2.cjs", () => ({ c: () => "mocked c" }));
  await said("a CommonJS file under the mock", async () => require("./src/c2.cjs").c() + " " + (await import("./src/c2.cjs")).c());
  ${unmock}("./src/c2.cjs");
  await said("a CommonJS file behind its end", async () => require("./src/c2.cjs").c() + " " + (await import("./src/c2.cjs")).c());
  mock.module("./src/m2.js", () => ({ v: "mocked v", extra: 1 }));
  await said("an ES module under the mock", async () => require("./src/m2.js").v + " " + Object.keys(await import("./src/m2.js")).join());
  ${unmock}("./src/m2.js");
  await said("an ES module behind its end", async () => require("./src/m2.js").v + " " + Object.keys(await import("./src/m2.js")).join());
  mock.module("node:path", () => ({ sep: "mocked sep" }));
  await said("a built-in module under the mock", () => require("node:path").sep);
  ${unmock}("node:path");
  await said("a built-in module behind its end", () => require("node:path").sep);
});`;

test.each([
  ["vi", "vi.doUnmock"],
  ["jest", "jest.dontMock"],
])("%s: %s ends the mock", async (from, unmock) => {
  using dir = tempDir("mock-unmock", {
    "package.json": `{ "name": "mock-unmock" }`,
    ...Object.fromEntries(
      ["c1", "c2"].map(name => [
        `src/${name}.cjs`,
        `console.error("SEEN the body of ${name} runs"); exports.c = () => "real c";`,
      ]),
    ),
    ...Object.fromEntries(
      ["m1", "m2"].map(name => [
        `src/${name}.js`,
        `console.error("SEEN the body of ${name} runs"); export const v = "real v";`,
      ]),
    ),
    "a.test.js": testFile(from, unmock),
  });
  const seenWith = async (env: Record<string, string>, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, ...env });
    return { seen: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
  };
  const [plain, oneProgram, layers] = await Promise.all([
    seenWith({}),
    seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }, "--aot"),
    seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }, "--aot"),
  ]);
  expect(plain.seen).toContain("SEEN the body of c2 runs");
  expect(plain.seen).toContain("SEEN a CommonJS file behind its end | real c real c");
  expect(plain.seen).toContain("SEEN an ES module behind its end | real v v");
  expect(plain.exitCode).toBe(0);
  expect(oneProgram).toEqual(plain);
  expect(layers).toEqual(plain);
});
