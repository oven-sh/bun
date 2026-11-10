import { test, vi, mock } from "bun:test";
test("a", async () => {
  vi.doMock("./dep.mjs", () => ({ x: "first" }));
  const one = (await import("./dep.mjs")).x;
  vi.doUnmock("./dep.mjs");
  const two = (await import("./dep.mjs")).x;
  mock.module("./dep.mjs", () => new Promise(() => {}));
  console.log("SAID a", one, two, process.argv.length > 9 ? 1 : 0);
});
