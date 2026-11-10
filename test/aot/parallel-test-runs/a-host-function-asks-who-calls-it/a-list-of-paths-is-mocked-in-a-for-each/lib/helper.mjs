import { mock } from "bun:test";
export const layMocks = () => {
  ["./dep.mjs"].forEach(path => mock.module(path, () => ({ x: "mocked" })));
};
