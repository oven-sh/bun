import { test, mock, vi } from "bun:test";
import * as reader from "./reader.mjs";
test("a name of a mocked built-in module", async () => {
  mock.module("node:path", () => ({ sep: "mock" }));
  console.log("SAID under", reader.look(), globalThis.ran);
  vi.doUnmock("node:path");
  console.log("SAID ended", reader.look());
});
