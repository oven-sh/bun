import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./k.mjs", () => ({ x: "first" }));
  await import("./k.mjs");
  const early = await vi.importActual("./k.mjs");
  early.bump();
  vi.doUnmock("./k.mjs");
  const own = await import("./k.mjs");
  own.bump();
  own.bump();
  console.log("SAID a", own.count());
});
