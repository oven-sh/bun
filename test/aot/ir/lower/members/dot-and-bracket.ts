// RUN: lower
// CHECK-LABEL: function {{*}}name="bracket"
// CHECK: [[bracketObject]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: [[bracketValue]] = PropGet [[bracketObject]] key="a"
// CHECK-NEXT: Return [[bracketValue]]
// CHECK-LABEL: function {{*}}name="computed"
// CHECK-NEXT: ([[o]]: anything, [[x]]: anything):
// CHECK-NOT: PropGet
// CHECK: [[computedObject]] = Convert [[o]] declared={type={{*}}flags=[IsExpected]}
// CHECK-NEXT: [[computedValue]] = ElemGet [[computedObject]], [[x]]
// CHECK-NEXT: Return [[computedValue]]
// CHECK-LABEL: function {{*}}name="concatenated"
// CHECK: [[concatenatedObject]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: [[concatenatedValue]] = PropGet [[concatenatedObject]] key="a"
// CHECK-NEXT: Return [[concatenatedValue]]
// CHECK-LABEL: function {{*}}name="dot"
// CHECK: [[dotObject]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: [[dotValue]] = PropGet [[dotObject]] key="a"
// CHECK-NEXT: Return [[dotValue]]
// CHECK-LABEL: function {{*}}name="template"
// CHECK: [[templateObject]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: [[templateValue]] = PropGet [[templateObject]] key="a"
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
