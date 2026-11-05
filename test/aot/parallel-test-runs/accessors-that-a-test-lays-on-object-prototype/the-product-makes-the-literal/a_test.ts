import { test } from "bun:test";
import { make, nameOf } from "./product.ts";
test("a setter above every literal", () => {
  Object.defineProperty(Object.prototype, "late", { set(value) { (this as any).name = 7; }, configurable: true });
  const box = make("text");
  delete (Object.prototype as any).late;
  console.log(typeof nameOf(box), Object.hasOwn(box, "late"));
});
