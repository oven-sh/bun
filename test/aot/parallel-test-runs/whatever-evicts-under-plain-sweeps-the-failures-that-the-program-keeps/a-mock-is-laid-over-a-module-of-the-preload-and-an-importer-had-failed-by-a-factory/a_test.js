import { mock, test, vi } from "bun:test";
let calls = 0;
test("t", async () => {
  vi.doMock("./three.js", async () => { await null; if (++calls === 1) throw new Error("three fails"); return { three: "mock three" }; });
  console.log("SAID", await import("./all.js").then(got => got.all, error => error.message), calls);
  vi.doMock("./other.js", () => ({ other: "mock other" }));
  console.log("SAID", await import("./all.js").then(got => got.all, error => error.message), calls);
});
