import { test, vi, jest } from "bun:test";
test("t", async () => {
  console.log(require("./dep.mjs").value());
  vi.doMock("./dep.mjs", () => ({ value: () => "test" }));
  vi.doUnmock("./dep.mjs");
  console.log(jest.requireActual("./dep.mjs").value(), (await vi.importActual("./dep.mjs")).value());
});
