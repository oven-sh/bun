import { jest, mock, test, vi } from "bun:test";
import * as index from "./index.mjs";
test("the mock ends and another is laid", () => {
  vi.doMock("./mail.cjs", () => ({ send: () => "mocked" }));
  jest.unmock("./mail.cjs");
  console.log("ended", index.send());
  mock.module("./mail.cjs", () => ({ send: () => "stub" }));
  console.log("laid", index.send());
  delete require.cache[require.resolve("./mail.cjs")];
});
