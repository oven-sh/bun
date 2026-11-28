import { expect, mock, test } from "bun:test";
test("ws", () => {
  mock.module("ws", () => ({ of: typeof require("ws").WebSocketServer }));
  expect(require("ws").of).toBe("function");
});
test("undici", () => {
  mock.module("undici", () => ({ of: typeof require("undici").fetch }));
  expect(require("undici").of).toBe("function");
});
test("bun:ffi", () => {
  mock.module("bun:ffi", () => ({ of: typeof require("bun:ffi").dlopen }));
  expect(require("bun:ffi").of).toBe("function");
});
test("node-fetch", () => {
  mock.module("node-fetch", () => ({ of: typeof require("node-fetch").Headers }));
  expect(require("node-fetch").of).toBe("function");
});
