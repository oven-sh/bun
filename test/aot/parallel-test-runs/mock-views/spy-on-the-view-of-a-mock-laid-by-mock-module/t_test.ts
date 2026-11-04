import { test, mock, spyOn } from "bun:test";
import { f } from "./dep";
test("t", async () => {
  mock.module("./dep", () => ({ f: () => "m1" }));
  const first = await import("./dep");
  console.log("under", first.f(), f());
  spyOn(first, "f").mockReturnValue("spied");
  console.log("spied", first.f(), f());
});
