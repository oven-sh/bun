import { test, vi } from "bun:test";
test("x", async () => {
  let fail; globalThis.gate = new Promise((r, j) => { fail = j; });
  const began = new Promise(r => { globalThis.began = r; });
  const keys = v => Object.keys(v).sort().map(k => k + "=" + (typeof v[k] === "function" ? "mocked " + vi.isMockFunction(v[k]) : String(v[k]))).join(",");
  const word = promise => promise.then(keys, error => error.name + ": " + error.message);
  const first = import("./part.mjs"); await began;
  vi.doMock("./part.mjs");
  fail(new RangeError("no"));
  console.log("SAID", await word(first), "&", await word(import("./part.mjs")), "&", await word(import("./part.mjs")));
});
