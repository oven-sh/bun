import { test, vi } from "bun:test";
const word = load => Promise.resolve(load).then(it => String(it.x), error => error.name);
const jobs = async n => { for (let job = 0; job < n; job++) await 0; };
test("a", async () => {
  import("./part.js").then(it => console.log("SAID floating got", it.x), error => console.log("SAID floating failed", error.message));
  await jobs(20);
  vi.doUnmock("./part.js");
  console.log("SAID a", globalThis.calls, await word(import("./part.js")));
});
