// `set` lies on the prototype above. The test adds a `set` of its own on the nearer prototype, which it comes to through a value, and that one hides the built-in.
// Red ("5,5,5, nobody") where BuiltinCells::willAddNameTo() does not mark the holder.
import { test } from "bun:test";
import { work } from "./product.ts";
let said = "nobody";
const holder: any = Object.getPrototypeOf(new Uint8Array(1));
const above: any = Object.getPrototypeOf(holder);
holder.set = function (this: unknown, ...rest: unknown[]) {
  said = "mine";
  return above.set.apply(this, rest);
};
test("the product meets what the test has laid", () => {
  console.log(work(), said);
});
