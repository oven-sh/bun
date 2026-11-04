// spyOn() is handed `process`.
import { expect, spyOn, test } from "bun:test";
import { facts } from "./product";

test("what the product sees", () => {
  console.log("before", facts());
  const spy = spyOn(process, "cwd").mockReturnValue(7 as any);
  console.log("under", facts(), process.cwd());
  spy.mockRestore();
  console.log("behind", facts());
});
