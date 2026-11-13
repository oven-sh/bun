import { jest, mock, test, vi } from "bun:test";
import "./user.mjs";
test("a", async () => {
  
  vi.doMock("./leaf.mjs", () => ({ tag: "first mock" }));
  mock.module("./leaf.mjs", () => ({ tag: "second mock" }));
  console.log("SAID a", (await import("./user.mjs")).read());
});
