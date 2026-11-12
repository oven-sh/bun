import { mock, test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("@made-up/absent/part", () => ({ word: "mock of b" }));
  console.log("SAID b", (await import("./user.mjs")).user());
});
