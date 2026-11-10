import { test, vi } from "bun:test";
import * as user from "./user.mjs";
test("the closure reads its exports, its imports and its 300 constants", () => {
  console.log(user.read(), user.peek(), user.count);
  console.log(user.read(), user.peek(), user.count);
});
test.skip("names the mocked file", () => {
  vi.doMock("./dep.mjs", () => ({ who: "mock" }));
});
