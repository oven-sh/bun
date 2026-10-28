// RUN: link
// CHECK: layout [[class]] kind=Instance name="C"{{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[interface]]]
// CHECK: layout [[source]] {{*}}fields=[{key="p" declared={type=undefined|null|[[class]] flags=[OmitsNull, OmitsUndefined]} {{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[target]]]
// CHECK: layout [[target]] {{*}}fields=[{key="p" declared={type=undefined|null|[[interface]] flags=[OmitsNull, OmitsUndefined]}
// CHECK: layout [[interface]] name="I"

// RUN(EDGES): link
// EDGES: layout [[first]] {{*}}module=[[entry]] {{*}}supertypes=[L
// EDGES: layout [[second]] {{*}}module=[[entry]] {{*}}supertypes=[L
// EDGES-NOT: module=[[entry]] {{*}}supertypes=
// EDGES: variable {{*}}name="f" module=[[entry]]

interface I {
  x: number;
}

class C {
  x = 1;
}

export function f(x: { p: C; q: number }) {
  const y: { p: I } = x;
  return y;
}

export const made = f({ p: new C(), q: 1 });
