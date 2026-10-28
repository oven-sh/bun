// OPTIONS: erase-types
// RUN: lower
// CHECK-LABEL: function {{*}}name="read"
// CHECK: parameters=[{type=undefined|null|L{{*}} flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}]
// CHECK: [[x]] = PropGet {{*}}key="x"
// CHECK-NEXT: = Convert [[x]] declared={type=number flags=[IsExpected]}
// CHECK-LABEL: function {{*}}name="store"
// CHECK: ([[value]]: anything):
// CHECK: = Convert [[value]] declared={type=number flags=[IsExpected]}
// CHECK: Return

// RUN(REQUESTS): lower
// REQUESTS-NOT: IsChecked
// REQUESTS-NOT: site=
// REQUESTS-NOT: illTypedCause=

export function read(p: { x: number }) {
  return p.x;
}

export function store(x: any) {
  const v: number = x;
  return v;
}
