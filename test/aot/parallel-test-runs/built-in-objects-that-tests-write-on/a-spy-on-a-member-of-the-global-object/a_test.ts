// spyOn() is handed the global object: it replaces one member of it.
import { expect, spyOn, test } from "bun:test";
import { facts } from "./product";

test("what the product sees", () => {
  console.log("before", facts());
  const spy = spyOn(globalThis, "fetch").mockImplementation((() => "spied") as any);
  console.log("under", facts(), (fetch as any)("x"));
  spy.mockRestore();
  console.log("behind", facts());
});
