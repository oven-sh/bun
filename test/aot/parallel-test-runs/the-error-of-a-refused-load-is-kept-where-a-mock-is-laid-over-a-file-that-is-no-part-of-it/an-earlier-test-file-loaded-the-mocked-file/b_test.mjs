import { test, vi } from "bun:test";
// An earlier test file loaded rung.mjs, so `bun test` makes a pass over the loader where this one lays a mock over it: what failed goes out, and the load is refused with a new error.
test("the error", async () => {
  const get = load => load.then(() => "loaded", error => error);
  const refused = [await get(import("./ledger.mjs")), await get(import("./ledger.mjs"))];
  vi.doMock("./rung.mjs", () => ({ rung: "mock" }));
  refused.push(await get(import("./ledger.mjs")));
  console.log("SAID refused", refused.map(error => error.name + " " + (error === refused[0])).join());
});
