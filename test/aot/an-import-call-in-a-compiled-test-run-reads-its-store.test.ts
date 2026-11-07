import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A compiled test run reads the text of what an import() names in a later turn, and makes the call again then. What the import()
// loads still reads the store of AsyncLocalStorage that the call was made under, as under `bun test`.
const files = {
  "stores.test.js": `import { expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
const store = new AsyncLocalStorage();
const seen = [];
globalThis.see = label => seen.push(label + " " + store.getStore());
test("what an import() loads reads the store of the call", async () => {
  await store.run("first", () => import("./graph.mjs"));
  await store.run("second", () => import("./other.mjs"));
  expect(seen).toEqual(["file first", "below first", "graph first", "other second"]);
});
`,
  "graph.mjs": `import "./below.mjs";
import "./file.cjs";
see("graph");
`,
  "below.mjs": `see("below");
export {};
`,
  "file.cjs": `see("file");
module.exports = {};
`,
  "other.mjs": `see("other");
export {};
`,
};

test.each(["test", "test --aot"])("bun %s", async command => {
  using dir = tempDir("aot-store-of-an-import-call-in-a-test-run", files);
  const tested = await run([bunExe(), ...command.split(" "), "./stores.test.js"], String(dir), bunEnv);
  expect(tested.stderr).toContain("1 pass");
  expect(tested.exitCode).toBe(0);
});
