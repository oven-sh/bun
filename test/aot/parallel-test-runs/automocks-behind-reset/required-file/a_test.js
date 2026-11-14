import { test, vi, beforeEach } from "bun:test";
beforeEach(() => {
  vi.resetModules();
});
test("factory", () => {
  vi.doMock("./dep.cjs", () => ({ value: () => "factory", other: "of factory" }));
  console.log(require("./sub.cjs").read());
});
test("automock", () => {
  vi.doMock("./dep.cjs");
  const mocked = require("./dep.cjs");
  console.log(vi.isMockFunction(mocked.value), mocked.value(), mocked.other, require("./sub.cjs").read());
});
test("spy", () => {
  vi.doMock("./dep.cjs", { spy: true });
  const spied = require("./dep.cjs");
  console.log(vi.isMockFunction(spied.value), spied.value(), require("./sub.cjs").read());
});
