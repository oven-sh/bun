import { test, vi } from "bun:test";
test("readers of one file", async () => {
  const readers = [];
  vi.doMock("./part.mjs", () => ({ sep: "mock" }));
  readers.push(await import("./one.mjs"));
  console.log("SAID one", readers.map(each => each.late()).join(" | "));
  readers.push(await import("./two.mjs"));
  console.log("SAID two", readers.map(each => each.late()).join(" | "));
  vi.doUnmock("./part.mjs");
  console.log("SAID ended", readers.map(each => each.late()).join(" | "));
});
