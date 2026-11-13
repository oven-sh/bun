import { test, vi } from "bun:test";
const note = text => (globalThis.order ??= []).push(text);
test("a", async () => {
  vi.doMock("./unit.cjs", async original => { note("u<"); await 0; note("u>"); return { kept: "mock", default: "mock" }; });
  let said;
  try { said = (await import("./user.mjs")).say(); } catch (error) { said = error.name; }
  console.log("SAID", said);
});
