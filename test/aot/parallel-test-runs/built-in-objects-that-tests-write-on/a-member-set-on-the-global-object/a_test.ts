// Reflect.set() is handed the global object.
import { expect, spyOn, test } from "bun:test";
import { facts } from "./product";

test("what the product sees", () => {
  console.log("before", facts());
  Reflect.set(globalThis, "added", 2);
  console.log("under", facts(), Reflect.has(globalThis, "added"));
  delete (globalThis as any).added;
  console.log("behind", facts());
});
