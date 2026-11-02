// Passes an int32 field to an int32 parameter. The object that has the field comes out of a getter of `new Factory()`.
import type { int32 } from "bun";

class Point {
  x: int32 = 1;
}

class Factory {
  get point(): Point {
    return new Point();
  }
}

function take(n: int32): string {
  return "took " + (n + 1);
}

console.log(take(new Factory().point.x));
