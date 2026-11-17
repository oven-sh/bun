import { test, vi } from "bun:test";
const counter = require("./counter.cjs");

test("a mock that nothing loads", () => {
  vi.doMock("./counter.cjs", () => ({ count: 100 }));
  counter.increment();
  console.log("a", counter.count);
});
