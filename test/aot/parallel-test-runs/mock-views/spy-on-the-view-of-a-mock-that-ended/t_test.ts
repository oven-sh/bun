// `first` reads its names off the mock that it was made under, for good. A spy on it is laid there, and not in the variable of the module.
import { test, vi } from "bun:test";
import { f } from "./dep";
test("t", async () => {
  vi.doMock("./dep", () => ({ f: () => "m1" }));
  const first = await import("./dep");
  console.log("under", first.f(), f());
  vi.doUnmock("./dep");
  vi.spyOn(first, "f").mockReturnValue("spied");
  console.log("behind", first.f(), f());
});
