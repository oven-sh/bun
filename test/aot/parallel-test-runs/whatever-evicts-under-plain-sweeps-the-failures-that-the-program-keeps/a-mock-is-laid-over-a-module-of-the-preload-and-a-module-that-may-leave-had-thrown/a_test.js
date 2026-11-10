import { mock, test, vi } from "bun:test";
test("t", async () => {
  console.log("SAID", await import("./config.js").then(got => got.state, error => error.message));
  globalThis.settings = true;
  vi.doMock("./dep.js", () => ({ dep: "mock dep" }));
  console.log("SAID", await import("./config.js").then(got => got.state, error => error.message));
});
