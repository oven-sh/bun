import { expect, mock, test } from "bun:test";
import reads from "./reads.cjs";
test("the later one counts", () => {
  require.cache.os = { exports: { from: "entry" } };
  require.cache.sys = { exports: { from: "entry" } };
  reads("stored");
  mock.module("os", () => ({ from: "mock" }));
  mock.module("util", () => ({ from: "mock" }));
  reads("mocked");
  expect(require("os").from).toBe("mock");
  require.cache.os = { exports: { from: "later entry" } };
  reads("stored again");
});
