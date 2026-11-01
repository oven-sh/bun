// Reads an int32 field of an instance that a getter returns. The classes are declared in another file, and the object with the getter has no name.
import type { int32 } from "bun";
import * as shapes from "./shapes.ts";
import Default, { Factory, Point, holder, make } from "./shapes.ts";

class Derived extends Factory {}

function take(n: int32): int32 {
  return n;
}
function pick(): typeof Point {
  return Point;
}

console.log(
  take(new Factory().point.x),
  take(make().point.x),
  take(new Default().point.x),
  take(new Derived().point.x),
);
console.log(
  take(new shapes.Factory().point.x),
  take(shapes.Factory.shared.x),
  take(shapes.holder.point.x),
  take(holder.point.x),
);
console.log(take(new (await import("./shapes.ts")).Factory().point.x), take(pick().count), take(new Point().x));
