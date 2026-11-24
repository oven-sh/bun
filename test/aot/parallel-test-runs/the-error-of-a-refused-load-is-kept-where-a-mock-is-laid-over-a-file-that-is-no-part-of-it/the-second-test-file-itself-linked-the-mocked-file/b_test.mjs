import { test, vi } from "bun:test";
// As in the first test file: rung.mjs was linked by this test file and never ran, and no earlier one has loaded it: `bun test` makes no pass.
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
