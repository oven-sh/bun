import { afterEach, expect, test, vi } from "bun:test";

afterEach(() => {
  vi.resetModules();
});

test("a test that takes the set-up's mock out", async () => {
  const mocked: any = await import("../src/service.ts");
  console.log(mocked.service());
  vi.doUnmock("lib");
  const real: any = await import("../src/service.ts");
  console.log(real.service());
  expect(mocked.service()).toEndWith("the set-up's");
  expect(real.service()).toEndWith("real");
});
