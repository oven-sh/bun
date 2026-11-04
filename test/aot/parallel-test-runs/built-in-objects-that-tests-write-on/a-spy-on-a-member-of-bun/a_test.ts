// spyOn() is handed `Bun`.
import { expect, spyOn, test } from "bun:test";
import { facts } from "./product";

test("what the product sees", () => {
  console.log("before", facts());
  const spy = spyOn(Bun, "which").mockReturnValue("spied");
  console.log("under", facts(), Bun.which("x"));
  spy.mockRestore();
  console.log("behind", facts());
});
