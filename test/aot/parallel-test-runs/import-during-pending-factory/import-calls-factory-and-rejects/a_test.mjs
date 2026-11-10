import { test, vi } from "bun:test";
let calls = 0;
const asked = () => import("./wick.mjs").then(names => names.width, error => "threw " + error.message);
test("an import that calls the factory waits for it", async () => {
  vi.doMock("./wick.mjs", async original => {
    await 0;
    throw new Error("the factory fails " + ++calls);
  });
  console.log("SAID first " + (await asked()));
  console.log("SAID required " + require("./wick.mjs").width);
  console.log("SAID second " + (await asked()));
  console.log("SAID third " + (await asked()));
  console.log("SAID ran " + (globalThis.ran ?? "none"));
}, 4000);
