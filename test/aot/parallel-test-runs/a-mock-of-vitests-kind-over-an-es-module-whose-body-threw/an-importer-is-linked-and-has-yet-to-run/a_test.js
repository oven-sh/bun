import { test, vi } from "bun:test";
let calls = 0;
test("a", async () => {
  console.log("SAID all", await import("./all.js").then(got => got.all(), error => error.message));

  vi.doMock("./dep.js", () => { calls++; return { dep: "mock dep" }; });
  console.log("SAID laid", calls);
  console.log("SAID all", await import("./all.js").then(got => got.all(), error => error.message));

  console.log("SAID calls", calls);
});
