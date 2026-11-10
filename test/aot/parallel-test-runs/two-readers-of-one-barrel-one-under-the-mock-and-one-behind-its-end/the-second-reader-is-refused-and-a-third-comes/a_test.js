import { test, vi } from "bun:test";
test("readers of one file", async () => {
  const readers = [];
  vi.doMock("./part.mjs", () => ({ sep: "mock" }));
  readers.push(await import("./one.mjs"));
  console.log("SAID under", readers.map(each => each.late()).join(" | "));
  vi.doUnmock("./part.mjs");
  try { await import("./two.mjs"); } catch (error) { console.log("SAID refused", error.constructor.name); }
  console.log("SAID behind the refusal", readers.map(each => each.late()).join(" | "));
  readers.push(await import("./three.mjs"));
  console.log("SAID behind", readers.map(each => each.late()).join(" | "));
});
