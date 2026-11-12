import { test, vi } from "bun:test";
test("b", async () => {
  const { read } = await import("./reader");
  vi.doMock("./dep", () => ({ value: () => "mock b" }));
  const later = await import("./later");
  console.log("b", read(), later.seen());
});
