import { jest, mock, test, vi } from "bun:test";
let calls = 0;
test("b", async () => {
  vi.doMock("./three.js", () => { if (++calls === 1) throw new Error("three fails"); return { three: "mock three" }; });
  console.log("SAID", await import("./only.js").then(got => got.said ?? got.three, error => error.message), calls);
  mock.module("./other.js", () => ({ other: "mock other" }));
  console.log("SAID", await import("./only.js").then(got => got.said ?? got.three, error => error.message), calls);
  console.log("SAID", await import("./only.js").then(got => got.said ?? got.three, error => error.message), calls);
});
