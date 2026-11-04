import { test, vi } from "bun:test";
import { f } from "./dep";
let first: typeof import("./dep");
test("one", async () => {
  vi.doMock("./dep", () => ({ f: () => "m1" }));
  first = await import("./dep");
  vi.doUnmock("./dep");
  console.log("one", first.f(), f());
});
test("two", () => {
  vi.spyOn(first, "f").mockReturnValue("spied");
  console.log("two", first.f(), f());
});
