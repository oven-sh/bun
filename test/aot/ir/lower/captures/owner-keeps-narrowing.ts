// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: b0([[v]]: undefined|null|number|string):
// CHECK: = NewClosure [[v]] function=
// CHECK: [[isString]] = TypeTest [[v]] testedType=string
// CHECK-NEXT: Branch [[isString]] -> taken [[yes]](| 0), notTaken [[no]](| 0)
// CHECK-NEXT: [[yes]]([[text]]):
// CHECK-NEXT: [[named]] = NarrowByTest [[v]], [[text]]
// CHECK-NOT: = Convert
// CHECK: = PropGet [[named]] key="length"

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: = NewObject
// ENVIRONMENTS-NOT: env L

// The owner tests the value that the closure copies, and reads it behind the test, under the name that stands for what the test has left. No narrowed type is written: the engine narrows by the test.
declare function log(read: () => unknown): void;

export function f(v: string | number) {
  log(() => v);
  if (typeof v === "string") return v.length;
}
