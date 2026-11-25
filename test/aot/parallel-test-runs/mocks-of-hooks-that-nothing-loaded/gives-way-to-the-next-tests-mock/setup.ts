import { beforeEach, jest, mock, vi } from "bun:test";

mock.module("./tide.cjs", () => ({ ...jest.requireActual("./tide.cjs"), height: () => "low" }));

let tests = 0;
beforeEach(() => {
  const test = ++tests;
  vi.doMock("./tide.cjs", () => ({ height: () => `in front of test ${test}` }));
});
