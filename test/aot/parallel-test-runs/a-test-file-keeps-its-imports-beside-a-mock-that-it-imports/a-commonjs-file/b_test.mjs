import { jest, test, vi } from "bun:test";
import { rate } from "./rates.cjs";
import * as rates from "./rates.cjs";
test("a mock is imported", async () => {
  vi.doMock("./rates.cjs", () => ({ rate: () => "mocked" }));
  console.log("imported", (await import("./rates.cjs")).rate());
  console.log("own", rate(), rates.rate());
  jest.resetModules();
  console.log("required", require("./rates.cjs").rate());
});
