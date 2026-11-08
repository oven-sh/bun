// RUN: link
// CHECK: layout {{*}}key="label"{{*}}supertypes=[

// RUN(OUTER): link
// OUTER: layout {{*}}key="count"{{*}}supertypes=[

// RUN(BELOW): link
// BELOW-NOT: layout {{*}}name="WidePoint"{{*}}supertypes=

// A value of one structural type is cast to another. The source goes below the target, and so does each member's type below the type of the member it is read as. What lies below
// a member is not compared: the types down there are ones nobody else asks the checker for.
// The layout of an object type has no name, so `WideHolder` and `WideOuter` are known by the one name that only they have.
class Point {
  x = 0;
}

class WidePoint {
  x = 1;
  y = 2;
}

interface Holder {
  point: Point;
}

interface WideHolder {
  point: WidePoint;
  label: string;
}

interface Outer {
  holder: Holder;
}

interface WideOuter {
  holder: WideHolder;
  count: number;
}

function read(outer: Outer) {
  return outer.holder.point.x;
}

export function pass(outer: WideOuter) {
  return read(outer as Outer);
}
