// RUN: lower
// CHECK-NOT: Call
// CHECK: [[one]] = Convert {{*}}declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: [[read]] = PropGet [[one]] key="nope"
// CHECK-NEXT: Call {{*}}, [[read]] calleeKey="log"
// CHECK-NOT: Call

// `import.meta.main` is true in the entry point: the arm that it rules out is left out, and the other runs, so it is lowered. The type error in it is not reported and stops no build.

// FILE: main.ts
if (!import.meta.main) { console.log(0); } else console.log((1 as number)
.nope);
export {};
