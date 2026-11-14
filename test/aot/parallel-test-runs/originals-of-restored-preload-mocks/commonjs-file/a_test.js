import { test, vi, jest, afterEach } from "bun:test";
afterEach(() => {
  vi.doUnmock("./dep.cjs");
});
test("mock", async () => {
  console.log((await import("./dep.cjs")).value());
  vi.doMock("./dep.cjs", () => ({ value: () => "test" }));
  console.log((await import("./dep.cjs")).value());
});
test("original", async () => {
  console.log((await vi.importActual("./dep.cjs")).value(), jest.requireActual("./dep.cjs").value());
  const mocked = await vi.importMock("./dep.cjs");
  console.log(vi.isMockFunction(mocked.value), (await import("./dep.cjs")).value());
});
test("original in factory", async () => {
  vi.doMock("./dep.cjs", () => ({ value: () => "over " + jest.requireActual("./dep.cjs").value() }));
  console.log((await import("./dep.cjs")).value());
});
