// RUN: lower
// CHECK-LABEL: function {{*}}name="element"
// CHECK: [[item]] = ElemGet [[xs]], [[i]]
// CHECK-NEXT: Return [[item]]
// CHECK-LABEL: function {{*}}name="field"
// CHECK: results=[{type=number}]
// CHECK: [[x]] = PropGet [[p]] key="x"
// CHECK-NEXT: [[returned]] = Convert [[x]] declared={type=number} @
// CHECK-NEXT: Return [[returned]]
// CHECK-LABEL: function {{*}}name="store"
// CHECK-NEXT: ([[target]]: {{*}}, [[v]]:
// CHECK: PropSet [[target]], [[v]] key="x"
// CHECK-LABEL: function {{*}}name="untyped"
// CHECK-NEXT: ([[typed]]:
// CHECK: [[read]] = PropGet [[typed]] key="x"
// CHECK-NEXT: Return [[read]]

// An element or a field that is read is converted to nothing: the engine follows what is stored. The only conversion in `field` is the one to the result of the function, which is written. The layout says what a field is declared to hold, so what is stored in a field is not converted either. A cast to `any` says nothing, and neither does a member of `any`.
interface P {
  x: number;
}

export function element(xs: number[], i: number) {
  return xs[i];
}

export function field(p: P): number {
  return p.x;
}

export function store(p: P, v: any) {
  p.x = v;
}

export function untyped(p: P) {
  return (p as any).x;
}
