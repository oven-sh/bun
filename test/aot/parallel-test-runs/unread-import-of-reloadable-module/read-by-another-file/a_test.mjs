import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./base.mjs", () => ({ base: "mocked" }));
  const { outer } = await import("./outer.mjs");
  const { reach } = await import("./reach.mjs");
  console.log("SAID", outer(), await reach());
});
