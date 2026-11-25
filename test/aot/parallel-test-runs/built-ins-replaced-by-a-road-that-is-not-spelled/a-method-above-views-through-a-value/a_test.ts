// `set` lies on the prototype above every kind of view, which has no name of its own. The test comes to it through a value and stores over it.
// What is compiled calls `set` without looking it up for as long as the member is as built: the store says at run time that it no longer is.
// Red ("5,5,5, nobody") where BuiltinCells::willWrite() does not mark the member.
import { test } from "bun:test";
import { work } from "./product.ts";
let said = "nobody";
const holder: any = Object.getPrototypeOf(Object.getPrototypeOf(new Int16Array(1)));
const old = holder.set;
holder.set = function (this: unknown, ...rest: unknown[]) {
  said = "mine";
  return old.apply(this, rest);
};
test("the product meets what the test has laid", () => {
  console.log(work(), said);
});
