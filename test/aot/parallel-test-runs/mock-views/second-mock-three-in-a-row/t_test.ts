import { read } from "./reader";
import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./dep", () => ({ value: () => "m1" }));
  const later = await import("./later");
  vi.doMock("./dep", () => ({ value: () => "m2" }));
  const { last } = await import("./last");
  vi.doMock("./dep", () => ({ value: () => "m3" }));
  const { third } = await import("./third");
  console.log("t", read(), later.seen(), last(), third());
});
