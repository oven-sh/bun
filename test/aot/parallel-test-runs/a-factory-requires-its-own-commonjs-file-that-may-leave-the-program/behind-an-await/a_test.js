import { test } from "bun:test";
const jobs = async n => { for (let job = 0; job < n; job++) await 0; };
test("a", async () => {
  const loading = import("./part.cjs").then(it => String(it.x ?? it.default?.x), error => error.name);
  await jobs(10);
  globalThis.gate.resolve();
  console.log("SAID", await loading, globalThis.calls, globalThis.ran ?? 0);
});
globalThis.neverCalled = () => { delete require.cache[require.resolve("./part.cjs")]; };
