// RUN: lower
// CHECK: [[one]] = Convert {{*}}declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: [[read]] = PropGet [[one]] key="nope"
// CHECK-NEXT: Call {{*}}, [[read]] calleeKey="log"

// What stands behind `import.meta.main` of the entry point runs, so it is lowered. The type error in it is not reported and stops no build.

// FILE: main.ts
if (import.meta.main) console.log((1 as number)
.nope);
export {};
