import { test, vi } from "bun:test";
import { f } from "./dep";
test("t", async () => {
  vi.doMock("./dep", () => ({ f: () => "m1" }));
  const first = await import("./dep");
  vi.doUnmock("./dep");
  const spy = vi.spyOn(first, "f").mockReturnValue("spied");
  console.log("spied", first.f(), f(), spy.mock.calls.length);
  spy.mockRestore();
  console.log("restored", first.f(), f());
});
