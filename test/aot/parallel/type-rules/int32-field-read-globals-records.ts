// Reads an int32 field of an instance that is found in a property of globalThis, under an enum member of a record, in the result of an iterator, or through a getter defined by a descriptor.
import type { int32 } from "bun";

class Point {
  x: int32;
  constructor(x: int32) {
    this.x = x;
  }
}
enum Corner {
  Left = "left",
  Right = "right",
}
class Described {
  declare point: Point;
}
Object.defineProperty(Described.prototype, "point", {
  get() {
    return new Point(4);
  },
});
declare global {
  var pointSharedThroughTheGlobalObject: Point;
}
globalThis.pointSharedThroughTheGlobalObject = new Point(1);

function take(n: int32): int32 {
  return n;
}
const corners: Record<Corner, Point> = { left: new Point(2), right: new Point(3) };
const points = new Set<Point>([new Point(5)]);
const byName = new Map<string, Point>([["a", new Point(6)]]);

console.log(take(globalThis.pointSharedThroughTheGlobalObject.x));
console.log(take(corners[Corner.Left].x), take(corners[Corner.Right].x));
console.log(take(new Described().point.x));
console.log(take(points.values().next().value!.x));
console.log(take(byName.entries().next().value![1].x));
