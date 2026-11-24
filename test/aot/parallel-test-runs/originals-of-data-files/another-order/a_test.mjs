import { test, vi } from "bun:test";
const note = text => (globalThis.order ??= []).push(text);
test("a", async () => {
  vi.doMock("./a.json", async original => { note("a<"); const all = await original(); note("a>"); return { ...all, kept: "mock", default: "mock" }; });
  let said;
  try { said = (await import("./user.mjs")).say(); } catch (error) { said = error.name + " " + (globalThis.order ?? []).join(" "); }
  console.log("SAID", said);
});
