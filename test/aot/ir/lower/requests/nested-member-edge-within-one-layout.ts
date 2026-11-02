// RUN: link
// CHECK: layout [[class]] kind=Instance name="C"{{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[interface]]]
// CHECK: layout [[holder]] {{*}}fields=[{key="p" declared={type=undefined|null|[[class]]|[[interface]] flags=[OmitsNull, OmitsUndefined]} flags=[{{*}}]}]
// CHECK-NOT: supertypes=
// CHECK: layout [[interface]] name="I"

// `{ p: C }` and `{ p: I }` have one layout, so the conversion adds no edge between them. What `p` holds still flows from `C` to `I`.
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
