import { read } from "./reader";
import { test, vi } from "bun:test";
test("one", async () => {
  vi.doMock("./dep", () => ({ value: () => "m1" }));
  const later = await import("./later");
  console.log("one", read(), later.seen());
});
test("two", async () => {
  vi.doMock("./dep", () => ({ value: () => "m2" }));
  const { last } = await import("./last");
  console.log("two", read(), last());
});
