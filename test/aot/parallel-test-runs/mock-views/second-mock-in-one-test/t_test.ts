// reader.ts was linked to dep.ts itself, ahead of both mocks: it keeps the module under the second as under the first.
import { read } from "./reader";
import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./dep", () => ({ value: () => "m1" }));
  const later = await import("./later");
  vi.doMock("./dep", () => ({ value: () => "m2" }));
  const { last } = await import("./last");
  console.log("t", read(), later.seen(), last());
});
