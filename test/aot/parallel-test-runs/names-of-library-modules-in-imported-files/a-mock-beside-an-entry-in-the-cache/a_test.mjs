import { mock, test } from "bun:test";
import reads from "./reads.mjs";
test("mocks", () => {
  reads("before");
  mock.module("os", () => ({ from: "mock" }));
  mock.module("util", () => ({ from: "mock" }));
  reads("mocked");
});
