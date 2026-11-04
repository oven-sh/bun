// RUN: link
// CHECK: layout {{*}}fields=[{key="x"{{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[derived]]]
// CHECK: layout [[derived]] {{*}}fields=[{key="deep"
// CHECK-NOT: supertypes=
// CHECK: layout

// RUN(SIDEWAYS): link
// SIDEWAYS: layout [[right]] {{*}}fields=[{key="kind"{{*}}{key="right"
// SIDEWAYS: layout {{*}}fields=[{key="kind"{{*}}{key="left"{{*}}supertypes=[
// SIDEWAYS-NOT: ,
// SIDEWAYS: [[right]]]

// RUN(RIGHT): link
// RIGHT-NOT: layout {{*}}{key="right"{{*}}supertypes=

// RUN(UNRELATED): link
// UNRELATED: layout {{*}}fields=[{key="odd"
// UNRELATED-NOT: supertypes=
// UNRELATED: layout

// A cast down or sideways says that an object of the one type is an object of the other, and the code after it relies on that. So the layout of the
// source goes below the layout of the target, as in a conversion that the checker allows. Of a union, only the members that could be cast alone do.
interface Base {
  x: number;
}

interface Derived {
  deep: number;
  x: number;
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
  odd: number;
  x: string;
}

export function down(b: Base | Unrelated) {
  return b as Derived;
}

export function sideways(l: Left) {
  return l as Right;
}
