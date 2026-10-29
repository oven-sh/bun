// RUN: lower
// CHECK-LABEL: function {{*}}name="f"{{*}}HasArgumentCount, HasHiddenRest
// CHECK: [[arguments]] = CreateUnmappedArguments
// CHECK: = NewClosure [[arguments]] function=
// CHECK-LABEL: function {{*}}kind=Arrow{{*}}captures=[{type=anything}]
// CHECK: b0([[copy]]: anything):
// CHECK-NOT: = Create
// CHECK: [[result]] = [[cast]] [[copy]]
// CHECK-NEXT: Return [[result]]

// RUN(COPY): lower
// COPY-NOT: GetEnvironmentField
// COPY-NOT: = NewObject
// COPY-NOT: kind=Arrow{{*}}HasArgumentCount

export function f() {
  return () => arguments;
}
