// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: b0([[v]]: undefined|null|number|string):
// CHECK: = NewClosure [[v]] function=
// CHECK: [[isString]] = TypeTest [[v]] testedType=string
// CHECK-NEXT: Branch [[isString]] -> taken [[yes]](| 0), notTaken [[no]](| 0)
// CHECK-NEXT: [[yes]]([[string]]):
// CHECK: [[narrowed]] = Convert [[string]] declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK: = PropGet [[narrowed]] key="length"

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: = NewObject
// ENVIRONMENTS-NOT: env L

declare function log(read: () => unknown): void;

export function f(v: string | number) {
  log(() => v);
  if (typeof v === "string") return v.length;
}
