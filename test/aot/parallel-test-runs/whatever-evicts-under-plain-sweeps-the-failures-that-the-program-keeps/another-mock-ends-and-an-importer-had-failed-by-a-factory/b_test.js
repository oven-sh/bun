import { jest, mock, test, vi } from "bun:test";
let calls = 0;
test("b", async () => {
  vi.doMock("./third.js", () => ({ third: "mock third" })); console.log("SAID", (await import("./third.js")).third);
  vi.doMock("./three.js", async () => { await null; if (++calls === 1) throw new Error("three fails"); return { three: "mock three" }; });
  console.log("SAID", await import("./all.js").then(got => got.said ?? got.three, error => error.message), calls);
  vi.doUnmock("./third.js");
  console.log("SAID", await import("./all.js").then(got => got.said ?? got.three, error => error.message), calls);
  console.log("SAID", await import("./all.js").then(got => got.said ?? got.three, error => error.message), calls);
});
