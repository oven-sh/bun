import { jest, test, vi } from "bun:test";
test("the evicted failure is not what the next mock patches", async () => {
  vi.doMock("./lib.mjs", () => ({ a: "first" }));
  vi.doUnmock("./lib.mjs");
  jest.doMock("./lib.mjs", () => {
    console.log("the factory is called");
    return { a: "second" };
  });
  console.log("mocked again");
  console.log("import", (await import("./lib.mjs")).a, "runs", globalThis.runs);
});
