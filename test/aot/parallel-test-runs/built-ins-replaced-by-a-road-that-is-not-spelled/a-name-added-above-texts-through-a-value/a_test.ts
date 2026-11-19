// `hasOwnProperty` lies above the prototype of texts. The test adds one of its own on that prototype, which it comes to through a value.
// Red ("true,true,true, nobody") where BuiltinCells::noteWriteAboveInstances() does not mark the class.
import { test } from "bun:test";
import { work } from "./product.ts";
let said = "nobody";
const holder: any = Object.getPrototypeOf("x");
const above: any = Object.getPrototypeOf(holder);
holder.hasOwnProperty = function (this: unknown, ...rest: unknown[]) {
  said = "mine";
  return above.hasOwnProperty.apply(this, rest);
};
test("the product meets what the test has laid", () => {
  console.log(work(), said);
});
