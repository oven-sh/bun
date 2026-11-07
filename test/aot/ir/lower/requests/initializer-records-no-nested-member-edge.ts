// RUN: link
// CHECK: layout [[class]] kind=Instance name="C"
// CHECK-NOT: supertypes=
// CHECK: layout [[target]] {{*}}fields=[{key="p" declared={type=undefined|null|[[interface]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NOT: supertypes=
// CHECK: layout [[source]] {{*}}fields=[{key="p" declared={type=undefined|null|[[class]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NOT: supertypes=
// CHECK: layout [[interface]]
// CHECK-NOT: supertypes=
// CHECK: variable {{*}}name="f"
// CHECK: function {{*}}name="f" module=
// CHECK: = Convert {{*}}declared={type=undefined|null|[[target]] flags=[OmitsNull, OmitsUndefined]}

// The initializer is converted to the type that is written, and adds to no family: `{ p: C; q: number }` does not go below `{ p: I }`, nor `C` below `I`.
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
