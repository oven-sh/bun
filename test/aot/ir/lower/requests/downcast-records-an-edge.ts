// RUN: link
// CHECK: layout {{*}}name="Base" {{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[derived]]]
// CHECK: layout [[derived]] name="Derived"
// CHECK-NOT: supertypes=
// CHECK: layout

// RUN(SIDEWAYS): link
// SIDEWAYS: layout {{*}}name="Left" {{*}}supertypes=[
// SIDEWAYS-NOT: ,
// SIDEWAYS: [[right]]]
// SIDEWAYS: layout [[right]] name="Right"
// SIDEWAYS-NOT: supertypes=
// SIDEWAYS: layout

// RUN(UNRELATED): link
// UNRELATED: layout {{*}}name="Unrelated"
// UNRELATED-NOT: supertypes=
// UNRELATED: layout

// A cast down or sideways says that an object of the one type is an object of the other, and the code after it relies on that. So the layout of the
// source goes below the layout of the target, as in a conversion that the checker allows. Of a union, only the members that could be cast alone do.
interface Base {
  x: number;
}

interface Derived {
  x: number;
  y: number;
}

interface Left {
  kind: "a" | "b";
  left?: number;
}

interface Right {
  kind: "b" | "c";
  right?: number;
}

interface Unrelated {
  x: string;
  z: number;
}

export function down(b: Base | Unrelated) {
  return b as Derived;
}

export function sideways(l: Left) {
  return l as Right;
}
