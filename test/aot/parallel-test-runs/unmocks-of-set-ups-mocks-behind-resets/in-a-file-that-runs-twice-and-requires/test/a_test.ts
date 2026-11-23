import { afterAll, expect, jest, test, vi } from "bun:test";

afterAll(() => {
  vi.resetModules();
});

test("a test that takes the set-up's mock out", () => {
  const mocked: any = require("../src/service.ts");
  console.log(mocked.service());
  jest.dontMock("lib");
  const real: any = require("../src/service.ts");
  console.log(real.service());
  expect(mocked.service()).toEndWith("the set-up's");
  expect(real.service()).toEndWith("real");
});
