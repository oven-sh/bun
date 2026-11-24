import { afterEach, expect, test, vi } from "bun:test";

afterEach(() => {
  vi.resetModules();
});

test("a test that lays two mocks over what it has imported", async () => {
  const first: any = await import("../src/service.ts");
  vi.doMock("lib", () => ({ price: () => "the first" }));
  await import("../src/service.ts");
  vi.doMock("lib", () => ({ price: () => "the second" }));
  const again: any = await import("../src/service.ts");
  console.log(first.service(), "|", again.service());
  expect(first.service()).toEndWith("the set-up's");
});
