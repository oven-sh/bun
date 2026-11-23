import { beforeEach, expect, test, vi } from "bun:test";
import { service } from "../src/service.ts";

beforeEach(() => {
  vi.resetModules();
});

test("a test that mocks the package twice", async () => {
  vi.doMock("lib", () => ({ price: () => "the first" }));
  const first: any = await import("../src/service.ts");
  console.log(first.service());
  vi.doMock("lib", () => ({ price: () => "the second" }));
  const second: any = await import("../src/service.ts");
  console.log(second.service(), "|", service());
  expect(second.service()).toEndWith("the second");
});
