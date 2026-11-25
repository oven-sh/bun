import { mock } from "bun:test";
export function* mocks() {
  mock.module("./dep.mjs", () => ({ x: "mocked" }));
  yield 1;
}
