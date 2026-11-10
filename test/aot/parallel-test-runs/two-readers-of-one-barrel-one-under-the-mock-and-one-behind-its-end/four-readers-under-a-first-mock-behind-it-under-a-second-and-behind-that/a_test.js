import { test, vi } from "bun:test";
test("readers of one file", async () => {
  const readers = [];
  vi.doMock("./part.mjs", () => ({ sep: "first" }));
  readers.push(await import("./one.mjs"));
  console.log("SAID 1", readers.map(each => each.late()).join(" | "));
  vi.doUnmock("./part.mjs");
  readers.push(await import("./two.mjs"));
  console.log("SAID 2", readers.map(each => each.late()).join(" | "));
  vi.doMock("./part.mjs", () => ({ sep: "second" }));
  readers.push(await import("./three.mjs"));
  console.log("SAID 3", readers.map(each => each.late()).join(" | "));
  vi.doUnmock("./part.mjs");
  readers.push(await import("./four.mjs"));
  console.log("SAID 4", readers.map(each => each.late()).join(" | "));
});
