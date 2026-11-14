import { test, vi, jest, afterEach } from "bun:test";
afterEach(() => {
  vi.doUnmock("./dep.mjs");
});
test("mock", async () => {
  console.log((await import("./dep.mjs")).value());
  vi.doMock("./dep.mjs", () => ({ value: () => "test" }));
  console.log((await import("./dep.mjs")).value());
});
test("original", async () => {
  console.log((await vi.importActual("./dep.mjs")).value(), jest.requireActual("./dep.mjs").value());
  const mocked = await vi.importMock("./dep.mjs");
  console.log(vi.isMockFunction(mocked.value), (await import("./dep.mjs")).value());
});
test("original in factory", async () => {
  vi.doMock("./dep.mjs", () => ({ value: () => "over " + jest.requireActual("./dep.mjs").value() }));
  console.log((await import("./dep.mjs")).value());
});
