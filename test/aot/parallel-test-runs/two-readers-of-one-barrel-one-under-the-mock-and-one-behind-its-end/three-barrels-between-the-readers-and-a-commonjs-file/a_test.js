import { test, vi } from "bun:test";
test("readers of one file", async () => {
  const readers = [];
  vi.doMock("./part.cjs", () => ({ sep: "mock" }));
  readers.push(await import("./one.mjs"));
  console.log("SAID under", readers.map(each => each.late()).join(" | "));
  vi.doUnmock("./part.cjs");
  readers.push(await import("./two.mjs"));
  console.log("SAID behind", readers.map(each => each.late()).join(" | "));
});
