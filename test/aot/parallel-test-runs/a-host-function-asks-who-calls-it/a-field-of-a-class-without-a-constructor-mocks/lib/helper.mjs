import { mock } from "bun:test";
export class Mocks {
  laid = mock.module("./dep.mjs", () => ({ x: "mocked" }));
}
