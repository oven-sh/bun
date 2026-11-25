// RUN: lower
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: b0([[v]]: undefined|null|number|string):
// CHECK: [[isString]] = TypeTest [[v]] testedType=string
// CHECK-NEXT: Branch [[isString]] -> taken [[yes]](| 0), notTaken [[no]](| 0)
// CHECK-NEXT: [[yes]]([[text]]):
// CHECK-NEXT: [[named]] = NarrowByTest [[v]], [[text]]
// CHECK-NOT: Convert
// CHECK: = PropGet [[named]] key="length"
// CHECK-NOT: Convert

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: = NewObject
// ENVIRONMENTS-NOT: env L

// The engine narrows by the test. No narrowed type is sent: behind the test the copy is read under the name that stands for what the test has left of it.
export function f(v: string | number) {
  return () => (typeof v === "string" ? v.length : v);
}
