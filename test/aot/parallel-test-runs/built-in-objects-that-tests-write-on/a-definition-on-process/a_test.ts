// Object.defineProperty() is handed `process`.
import { expect, spyOn, test } from "bun:test";
import { facts } from "./product";

test("what the product sees", () => {
  console.log("before", facts());
  const before = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: "never", configurable: true });
  console.log("under", facts());
  Object.defineProperty(process, "platform", before);
  console.log("behind", facts());
});
