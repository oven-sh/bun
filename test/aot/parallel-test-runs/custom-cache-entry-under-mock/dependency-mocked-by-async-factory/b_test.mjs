import { test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const key = require.resolve("./lib.mjs");
const ran = () => (globalThis.ran ?? []).join();
const tell = f => { try { return f(); } catch (e) { return e.name; } };
test("the second test file stores under the key and asks for the original", async () => {
  vi.doMock("./lib.mjs", () => ({ a: "mocked again" }));
  require.cache[key] = { exports: { a: "fake" } };
  console.log("SAID stored", ran());
  vi.doMock("./dep.mjs", async () => { (globalThis.ran ??= []).push("factory of b"); await new Promise(resolve => setTimeout(resolve, 5)); globalThis.ran.push("factory end"); return { d: "mocked in b" }; });
  const actual = await vi.importActual("./lib.mjs");
  console.log("SAID asked", actual.a, tell(() => actual.seen()), ran());
  await new Promise(resolve => setTimeout(resolve, 40));
  console.log("SAID later", tell(() => actual.seen()), ran());
});
