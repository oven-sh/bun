// RUN: link
// CHECK: layout {{*}}name="WidePoint"
// CHECK-NOT: supertypes=
// CHECK: layout {{*}}name="WideHolder"{{*}}supertypes=[{{*}}[[holder]]]
// CHECK: layout {{*}}name="WideOuter"{{*}}supertypes=[{{*}}[[outer]]]
// CHECK: layout [[outer]] name="Outer"
// CHECK: layout [[holder]] name="Holder"

// A value of one structural type flows into another. The source goes below the target, and so does each member's type below the type of the member it is read as. What lies below
// a member is not compared: a literal is converted where it is built, every read is tested where it stands, and the types down there are ones nobody else asks the checker for.
interface Point {
  x: number;
}

interface WidePoint {
  x: number;
  y: number;
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

function makePoint(): WidePoint {
  return { x: 1, y: 2 };
}

function makeHolder(): WideHolder {
  return { point: makePoint(), label: "a" };
}

function makeOuter(): WideOuter {
  return { holder: makeHolder(), count: 1 };
}

function read(outer: Outer) {
  return outer.holder.point.x;
}

export const x = read(makeOuter());
