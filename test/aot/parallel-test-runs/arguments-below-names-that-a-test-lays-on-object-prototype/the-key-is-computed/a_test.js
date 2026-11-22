import { test } from "bun:test";
import product from "./product.cjs";
const isArguments = (o) => Object.prototype.toString.call(o) === "[object Arguments]";
test("a parameter is one variable with arguments[0]", () => {
  Object.defineProperty(Object.prototype, "extra", { configurable: true, get() { if (isArguments(this)) this[0] = "changed"; return 1; } });
  let a = "";
  for (let i = 0; i < 300; i++) a = product.probe("kept");
  delete Object.prototype.extra;
  console.log(a);
});
