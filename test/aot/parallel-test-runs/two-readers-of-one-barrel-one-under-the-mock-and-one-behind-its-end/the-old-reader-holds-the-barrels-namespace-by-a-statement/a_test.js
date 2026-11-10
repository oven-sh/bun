import { test, mock, vi } from "bun:test";
test("doors", async () => {
  mock.module("./part.mjs", () => ({ name: "mock" }));
  const old = await import("./old.mjs");
  console.log("SAID under", await old.get());
  vi.doUnmock("./part.mjs");
  console.log("SAID off", await old.get());
  const late = await import("./late.mjs");
  console.log("SAID behind", await old.get(), late.get());
});
