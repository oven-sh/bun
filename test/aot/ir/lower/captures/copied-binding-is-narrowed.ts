// RUN: lower
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: b0([[v]]: undefined|null|number|string):
// CHECK: [[isString]] = TypeTest [[v]] testedType=string
// CHECK-NEXT: Branch [[isString]] -> taken [[yes]](| 0), notTaken [[no]](| 0)
// CHECK-NEXT: [[yes]]([[string]]):
// CHECK: [[narrowed]] = Convert [[string]] declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK: = PropGet [[narrowed]] key="length"

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: = NewObject
// ENVIRONMENTS-NOT: env L

export function f(v: string | number) {
  return () => (typeof v === "string" ? v.length : v);
}
