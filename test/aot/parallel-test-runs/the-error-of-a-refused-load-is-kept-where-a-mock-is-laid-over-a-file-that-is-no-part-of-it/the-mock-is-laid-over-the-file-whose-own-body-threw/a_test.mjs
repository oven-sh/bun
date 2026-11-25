import { test, vi } from "bun:test";
// crack.mjs threw below the root: its own entry is no failure, `bun test` sets it aside and makes no pass.
test("the error", async () => {
  const get = load => load.then(() => "loaded", error => error);
  const refused = [await get(import("./ledger.mjs")), await get(import("./ledger.mjs"))];
  const thrown = await get(import("./ladder.mjs"));
  refused.push(await get(import("./ledger.mjs")));
  vi.doMock("./crack.mjs", () => ({ ladder: "mock", crack: "mock" }));
  refused.push(await get(import("./ledger.mjs")));
  console.log("SAID thrown", thrown.message);
  console.log("SAID refused", refused.map(error => error.name + " " + (error === refused[0])).join());
});
