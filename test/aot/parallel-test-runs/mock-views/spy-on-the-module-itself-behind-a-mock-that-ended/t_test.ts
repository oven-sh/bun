import { test, vi } from "bun:test";
import { f } from "./dep";
test("t", async () => {
  vi.doMock("./dep", () => ({ f: () => "m1" }));
  const first = await import("./dep");
  vi.doUnmock("./dep");
  const real = await import("./dep");
  vi.spyOn(real, "f").mockReturnValue("spied");
  console.log("behind", first.f(), real.f(), f());
});
