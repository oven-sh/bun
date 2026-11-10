import { test, vi } from "bun:test";
const keyOf = name => new URL("./" + name, import.meta.url).pathname;
let last, calls = 0;
const load = async (name, get) => {
  try { console.log("SAID", name, "came", (await get()).got); }
  catch (error) { console.log("SAID", name, "threw", error.name, error === last ? "the same" : "another"); last = error; }
};
test("t", async () => {
  vi.doMock("./m1.mjs", async () => { await 0; if (++calls <= 1) throw new RangeError("factory"); return { m: "mock m1" }; });
  await load("first", () => import("./importer.mjs"));
  console.log("SAID deleted", delete require.cache[keyOf("m1.mjs")]);
  vi.doUnmock("./m1.mjs");
  await load("again", () => import("./importer.mjs"));
  console.log("SAID calls", calls);
});
