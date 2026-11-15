import { test, vi } from "bun:test";
const jobs = async count => { for (let job = 0; job < count; job++) await 0; };
test("a", async () => {
  import("./part.mjs").then(it => console.log("SAID got", it.x), error => console.log("SAID failed", error.message));
  await jobs(20);
  vi.doUnmock("./part.mjs");
  console.log("SAID", globalThis.calls, (await import("./part.mjs")).x);
});
