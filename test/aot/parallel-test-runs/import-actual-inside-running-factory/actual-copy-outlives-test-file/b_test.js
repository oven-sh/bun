import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./k.mjs", () => ({ x: "second" }));
  const again = await vi.importActual("./k.mjs");
  console.log("SAID b", again.count());
});
