import { jest, test, vi } from "bun:test";
import { rate } from "./rates.mjs";
import * as rates from "./rates.mjs";
test("a mock is imported", async () => {
  vi.doMock("./rates.mjs", () => ({ rate: () => "mocked" }));
  console.log("imported", (await import("./rates.mjs")).rate());
  console.log("own", rate(), rates.rate());
  jest.resetModules();
  console.log("required", require("./rates.mjs").rate());
});
