import { test } from "bun:test";
import product from "./product.cjs";
test("a parameter is one variable with arguments[0]", () => {
  Object.defineProperty(Object.prototype, "peek", { configurable: true, get() { return this[0]; } });
  const a = product.probe("kept");
  delete Object.prototype.peek;
  console.log(a);
});
