import { mock, test, vi } from "bun:test";
import * as rates from "./rates.mjs";
import * as index from "./index.mjs";
test("another mock ends it", () => {
  mock.module("./rates.mjs", () => ({ rate: () => "stub" }));
  delete require.cache[require.resolve("./rates.mjs")];
  console.log("required", require("./rates.mjs").rate());
  vi.doMock("./rates.mjs", () => ({ rate: () => "mocked" }));
  console.log("ended", rates.rate(), index.rate());
});
