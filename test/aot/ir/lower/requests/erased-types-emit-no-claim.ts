// OPTIONS: erase-types
// RUN: lower
// CHECK-LABEL: function {{*}}name="read"
// CHECK: parameters=[{type=undefined|null|L{{*}} flags=[IsExpected]}] results=[{type=anything}]
// CHECK: [[x]] = PropGet {{*}}key="x"
// CHECK-NEXT: Return [[x]]
// CHECK-LABEL: function {{*}}name="store"
// CHECK: ([[value]]: anything):
// CHECK-NOT: Convert
// CHECK: Return [[value]]

// RUN(REQUESTS): lower
// REQUESTS-NOT: IsChecked
// REQUESTS-NOT: site=
// REQUESTS-NOT: illTypedCause=

// Where the types are erased no annotation counts as written: the type of a parameter is only expected, and the annotation of `v` converts nothing.
export function read(p: { x: number }) {
  return p.x;
}

export function store(x: any) {
  const v: number = x;
  return v;
}
