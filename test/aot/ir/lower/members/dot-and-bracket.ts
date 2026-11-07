// RUN: lower
// CHECK-LABEL: function {{*}}name="bracket"
// CHECK-NEXT: ([[bracketObject]]: anything):
// CHECK: [[bracketValue]] = PropGet [[bracketObject]] key="a"
// CHECK-NEXT: Return [[bracketValue]]
// CHECK-LABEL: function {{*}}name="computed"
// CHECK-NEXT: ([[o]]: anything, [[x]]: anything):
// CHECK-NOT: PropGet
// CHECK: [[computedValue]] = ElemGet [[o]], [[x]]
// CHECK-NEXT: Return [[computedValue]]
// CHECK-LABEL: function {{*}}name="concatenated"
// CHECK-NEXT: ([[concatenatedObject]]: anything):
// CHECK: [[concatenatedValue]] = PropGet [[concatenatedObject]] key="a"
// CHECK-NEXT: Return [[concatenatedValue]]
// CHECK-LABEL: function {{*}}name="dot"
// CHECK-NEXT: ([[dotObject]]: anything):
// CHECK: [[dotValue]] = PropGet [[dotObject]] key="a"
// CHECK-NEXT: Return [[dotValue]]
// CHECK-LABEL: function {{*}}name="template"
// CHECK-NEXT: ([[templateObject]]: anything):
// CHECK: [[templateValue]] = PropGet [[templateObject]] key="a"
// CHECK-NEXT: Return [[templateValue]]

// RUN(ELEMENTS): lower
// ELEMENTS-COUNT-1: ElemGet
// ELEMENTS-NOT: ElemGet

// RUN(KEYS): lower
// KEYS-NOT: = String
// KEYS-NOT: = Add
// KEYS-NOT: Strcat

export function bracket(o: any) {
  return o["a"];
}

export function computed(o: any, x: any) {
  return o[x];
}

export function concatenated(o: any) {
  return o["a" + ""];
}

export function dot(o: any) {
  return o.a;
}

export function template(o: any) {
  return o[`a`];
}
