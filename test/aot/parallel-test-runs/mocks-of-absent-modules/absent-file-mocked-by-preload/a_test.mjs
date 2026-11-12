import { mock, test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./absent.mjs", () => ({ word: "mock of a" }));
  console.log("SAID a", (await import("./user.mjs")).user());
});
