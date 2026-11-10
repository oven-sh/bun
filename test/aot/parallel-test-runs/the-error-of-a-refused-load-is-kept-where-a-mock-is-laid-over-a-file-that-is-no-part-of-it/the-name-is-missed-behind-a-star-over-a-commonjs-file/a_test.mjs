import { test, vi } from "bun:test";
// As its neighbor, but only the run knows the names behind the star over legacy.cjs: the program itself keeps the failure of the refused load.
test("the error", async () => {
  const get = load => load.then(() => "loaded", error => error);
  const refused = [await get(import("./ledger.mjs")), await get(import("./ledger.mjs"))];
  const thrown = [await get(import("./ladder.mjs"))];
  refused.push(await get(import("./ledger.mjs")));
  vi.doMock("./rung.mjs", () => ({ rung: "mock" }));
  refused.push(await get(import("./ledger.mjs")));
  thrown.push(await get(import("./ladder.mjs")));
  console.log("SAID refused", refused.map(error => error.name + " " + (error === refused[0])).join());
  console.log("SAID thrown", thrown.map(error => error.message + " " + (error === thrown[0])).join());
});
