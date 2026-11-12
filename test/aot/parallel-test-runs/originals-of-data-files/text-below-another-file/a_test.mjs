import { test, vi } from "bun:test";
const note = text => (globalThis.order ??= []).push(text);
test("a", async () => {
  vi.doMock("./unit.txt", async original => { note("u<"); const all = await original(); note("u>"); return { ...all, kept: "mock", default: "mock" }; });
  let said;
  try { said = (await import("./user.mjs")).say(); } catch (error) { said = error.name; }
  console.log("SAID", said);
});
