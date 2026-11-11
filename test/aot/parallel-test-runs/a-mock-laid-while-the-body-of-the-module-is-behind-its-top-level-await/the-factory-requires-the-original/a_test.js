import { test, vi } from "bun:test";
const begun = new Promise(tell => { globalThis.tellThatBodyHasBegun = tell; });
test("the factory requires the original while its body waits", async () => {
  const first = import("./slow.mjs").then(held => held.get()); await begun;
  vi.doMock("./slow.mjs", () => { let seen; try { seen = require("./slow.mjs").state; } catch (error) { seen = error.constructor.name + " " + error.message.replace(/\/.*\//, "") + " " + error.code; } return { get: () => "mocked over " + seen }; });
  const second = (await import("./slow.mjs")).get(); console.log(`| SAID ${await first} | ${second}`);
});
