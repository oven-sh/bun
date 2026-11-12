import { test, vi } from "bun:test";
test("b", async () => {
  const keys = v => Object.keys(v).sort().map(k => k + "=" + (typeof v[k] === "function" ? "mocked " + vi.isMockFunction(v[k]) : String(v[k]))).join(",");
  const word = promise => promise.then(keys, error => error.name + ": " + error.message);
  globalThis.fail(new RangeError("no"));
  console.log("SAID b", await word(globalThis.first), "&", await word(globalThis.second), "&", await word(import("./part.mjs")));
}, 3000);
