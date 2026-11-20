import { test } from "bun:test";
import product from "./product.cjs";
test("a parameter is one variable with arguments[0]", () => {
  Object.defineProperty(Object.prototype, "keeper", { configurable: true, get() { return this; } });
  let b = "";
  for (let i = 0; i < 300; i++) b = product.later("kept");
  delete Object.prototype.keeper;
  console.log(b);
});
