// Object.assign() is handed the global object first.
import { expect, spyOn, test } from "bun:test";
import { facts } from "./product";

test("what the product sees", () => {
  console.log("before", facts());
  Object.assign(globalThis, { added: 1 });
  console.log("under", facts());
  Reflect.deleteProperty(globalThis, "added");
  console.log("behind", facts());
});
