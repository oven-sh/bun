import { test, vi } from "bun:test";
test("readers of one file", async () => {
  const readers = [];
  vi.doMock("./part.mjs", () => ({ sep: "mock" }));
  readers.push(await import("./one.mjs"));
  console.log("SAID under the first", readers.map(each => each.late()).join(" | "));
  vi.doUnmock("./part.mjs");
  vi.doMock("./part.mjs", () => ({ sep: "second" }));
  console.log("SAID the second is laid", readers.map(each => each.late()).join(" | "));
  readers.push(await import("./two.mjs"));
  console.log("SAID under the second", readers.map(each => each.late()).join(" | "));
  vi.doUnmock("./part.mjs");
  console.log("SAID ended", readers.map(each => each.late()).join(" | "));
});
