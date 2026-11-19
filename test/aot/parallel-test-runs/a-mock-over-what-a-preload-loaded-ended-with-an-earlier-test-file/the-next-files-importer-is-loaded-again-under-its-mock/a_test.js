import { mock, test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./dep.cjs", () => ({ dep: "first mock" }));
  console.log("SAID", (await import("./dep.cjs")).dep);
});
