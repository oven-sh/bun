import { test, vi } from "bun:test";
test("names", async () => {
    vi.doMock("./shapes.mjs", async original => { await original(); return { b: 3, c: 4 }; });
  let said;
  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.constructor.name + " " + String(error.message).split("\n")[0]; }
  console.log("SAID", said);
  const ns = await import("./shapes.mjs");
  console.log("SAID", Object.keys(ns).join(), "a" in ns, String(ns.a), "c" in ns, String(ns.c));
});
