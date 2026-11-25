import { mock } from "bun:test";
export function* mocks() {
  ["./dep.mjs"].forEach(path => mock.module(path, () => ({ x: "mocked" })));
  yield 1;
}
