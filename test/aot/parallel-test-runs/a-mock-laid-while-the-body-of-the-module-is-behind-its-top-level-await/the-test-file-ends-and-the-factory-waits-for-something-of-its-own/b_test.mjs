import { test, vi } from "bun:test";
test("b", async () => {
  const keys = v => Object.keys(v).sort().map(k => k + "=" + (typeof v[k] === "function" ? "mocked " + vi.isMockFunction(v[k]) : String(v[k]))).join(",");
  // Nothing can say that it never settles.
  const word = promise => Promise.race([promise.then(keys), new Promise(r => setTimeout(r, 300, "waits"))]);
  globalThis.open();
  console.log("SAID b", keys(await globalThis.first), "&", await word(globalThis.second), "&", keys(await import("./part.mjs")));
});
