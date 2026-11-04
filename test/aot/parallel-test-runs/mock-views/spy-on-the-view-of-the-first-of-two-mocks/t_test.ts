import { test, vi } from "bun:test";
import { f } from "./dep";
test("t", async () => {
  vi.doMock("./dep", () => ({ f: () => "m1" }));
  const first = await import("./dep");
  vi.doMock("./dep", () => ({ f: () => "m2" }));
  const second = await import("./dep");
  vi.spyOn(first, "f").mockReturnValue("spied");
  console.log("two", first.f(), second.f(), f());
  vi.doUnmock("./dep");
  console.log("behind", first.f(), second.f(), f());
});
