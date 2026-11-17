// RUN: link
// CHECK: layout [[class]] kind=Instance name="C"
// CHECK-NOT: supertypes=
// CHECK: layout [[holder]] {{*}}fields=[{key="p" declared={type=undefined|null|[[class]]|[[interface]] flags=[OmitsNull, OmitsUndefined]} flags=[{{*}}]}]
// CHECK-NOT: supertypes=
// CHECK: layout [[interface]]
// CHECK-NOT: supertypes=
// CHECK: variable {{*}}name="f"

// `{ p: C }` and `{ p: I }` have one layout, whose field lists both. An initializer adds to no family, so nothing says that what `p` holds flows from `C` to `I`.
interface I {
  x: number;
}

class C {
  x = 1;
}

export function f(x: { p: C }) {
  const y: { p: I } = x;
  return y;
}
