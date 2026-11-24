import { test, vi } from "bun:test";
// The entry of the root of an import() that failed cannot be set aside, so `bun test` takes it for stale and makes a pass: what failed goes out, and the load is refused with a new error.
test("the error", async () => {
  const get = load => load.then(() => "loaded", error => error);
  const refused = [await get(import("./ledger.mjs")), await get(import("./ledger.mjs"))];
  const thrown = await get(import("./ladder.mjs"));
  refused.push(await get(import("./ledger.mjs")));
  vi.doMock("./ladder.mjs", () => ({ ladder: "mock", crack: "mock" }));
  refused.push(await get(import("./ledger.mjs")));
  console.log("SAID thrown", thrown.message);
  console.log("SAID refused", refused.map(error => error.name + " " + (error === refused[0])).join());
});
