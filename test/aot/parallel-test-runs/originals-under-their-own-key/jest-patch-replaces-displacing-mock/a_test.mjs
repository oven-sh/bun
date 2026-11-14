import { jest, mock, test, vi } from "bun:test";

test("a", async () => {
  await import("./user.mjs");
  vi.doMock("./leaf.mjs", () => ({ tag: "first mock" }));
  jest.doMock("./leaf.mjs", () => ({ tag: "second mock" }));
  console.log("SAID a", (await import("./user.mjs")).read());
});
