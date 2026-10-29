// RUN: link
// CHECK: data {{*}}root=Array{contents=undefined|null|[[row]] elements=[Object{layout=[[row]] members={{*}}Object{layout=[[row]] members={{*}}Object{layout=[[row]] members=

// RUN(BUILT): lower
// BUILT-LABEL: function {{*}}name="alone"
// BUILT: = NewObject {{*}}layout=[[made]] fields=
// BUILT: = NewObject {{*}}layout=[[made]] fields=
// BUILT-LABEL: function {{*}}name="build"
// BUILT: = NewObject {{*}}layout=[[made]] fields=
// BUILT: = NewObject {{*}}layout=[[made]] fields=
// BUILT: = NewArray {{*}}contents=undefined|null|[[made]] @

// RUN(OTHER): lower
// OTHER-LABEL: function {{*}}name="otherShapes"
// OTHER: = NewObject {{*}}layout=[[first]] fields=
// OTHER-NOT: = NewObject {{*}}layout=[[first]] fields=
// OTHER: = NewArray

// Literals with the same names have one layout wherever they are written: the rows of a table, the elements of a list, two statements, two functions. Literals with other names have layouts of their own and keep the list a union.
export const table = [{ a: 1 }, { a: 2 }, { a: 3 }];

export function build(x: number) {
  return [{ p: x }, { p: x + 1 }];
}

export function otherShapes(x: number) {
  return [{ p: x }, { q: x }];
}

export function alone(x: number) {
  const first = { p: x };
  const second = { p: x };
  return first.p + second.p;
}
