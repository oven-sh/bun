import { test, vi } from "bun:test";

test("a file that mocks it again", async () => {
  const first: any = await import("../src/service.ts");
  console.log("b", first.service());
  vi.doMock("lib", () => ({ price: () => "the test's" }));
  const second: any = await import("../src/service.ts");
  console.log("b", second.service(), "|", first.service());
});
