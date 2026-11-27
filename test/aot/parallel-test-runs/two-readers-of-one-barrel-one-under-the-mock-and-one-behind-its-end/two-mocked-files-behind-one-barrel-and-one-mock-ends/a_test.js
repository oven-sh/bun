import { test, vi } from "bun:test";
test("readers of one file", async () => {
  const readers = [];
  vi.doMock("./other.mjs", () => ({ dot: "DOT" }));
  vi.doMock("./part.mjs", () => ({ sep: "mock" }));
  readers.push(await import("./one.mjs"));
  console.log("SAID under", readers.map(each => each.late()).join(" | "));
  vi.doUnmock("./part.mjs");
  readers.push(await import("./two.mjs"));
  console.log("SAID behind", readers.map(each => each.late()).join(" | "));
  vi.doUnmock("./other.mjs");
  console.log("SAID both ended", readers.map(each => each.late()).join(" | "));
});
