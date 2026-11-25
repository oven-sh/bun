import { afterEach, expect, test, vi } from "bun:test";

afterEach(() => {
  vi.resetModules();
});

test("a test that lays a mock over what it has imported and takes it out", async () => {
  const first: any = await import("../src/service.ts");
  vi.doMock("lib", () => ({ price: () => "the test's" }));
  vi.doUnmock("lib");
  const again: any = await import("../src/service.ts");
  console.log(first.service(), "|", again.service());
  expect(first.service()).toEndWith("the set-up's");
});
