import { test, vi } from "bun:test";
import { f } from "./dep";
test("t", async () => {
  vi.doMock("./dep", () => ({ f: () => "m1" }));
  const first = await import("./dep");
  vi.spyOn(first, "f").mockReturnValue("spied");
  console.log("under", first.f(), f());
  vi.doUnmock("./dep");
  console.log("behind", first.f(), f());
});
