import { test, vi } from "bun:test";
test("readers of one file", async () => {
  const readers = [];
  readers.push(await import("./one.mjs"));
  vi.doMock("./part.mjs", () => ({ sep: "mock" }));
  readers.push(await import("./two.mjs"));
  console.log("SAID under", readers.map(each => each.late()).join(" | "));
  vi.doUnmock("./part.mjs");
  readers.push(await import("./three.mjs"));
  console.log("SAID behind the end", readers.map(each => each.late()).join(" | "));
});
