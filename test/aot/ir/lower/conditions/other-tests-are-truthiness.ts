// RUN: lower
// CHECK-LABEL: function {{*}}name="arrayTest"
// CHECK: = Call {{*}}, [[list]] calleeName="Array.isArray"
// CHECK: [[isArray]] = ToBoolean
// CHECK-NEXT: Branch [[isArray]] ->
// CHECK: = Convert [[list]] declared={type=undefined|null|Array<number>} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="discriminant"
// CHECK: = PropGet [[union]] key="kind"
// CHECK: [[sameKind]] = StrictEq
// CHECK-NEXT: Branch [[sameKind]] -> taken [[kindTaken]](| 0), notTaken {{*}}(| 0)
// CHECK: [[kindTaken]]([[kindRead]]):
// CHECK-NEXT: [[narrowedUnion]] = NarrowByField [[union]], [[kindRead]] key="kind"
// CHECK: = Convert [[narrowedUnion]] declared={type=undefined|null|L{{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="guard"
// CHECK: = Call {{*}}, [[guarded]] calleeName="isGuard"
// CHECK: [[isGuarded]] = ToBoolean
// CHECK-NEXT: Branch [[isGuarded]] ->
// CHECK: = Convert [[guarded]] declared={type=undefined|null|L{{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="inTest"
// CHECK: [[has]] = PropHas [[holder]] key="a"
// CHECK-NEXT: [[hasBoolean]] = ToBoolean [[has]]
// CHECK-NEXT: Branch [[hasBoolean]] ->
// CHECK: = Convert [[holder]] declared={type=undefined|null|L{{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="instance"
// CHECK: [[isInstance]] = InstanceOf [[value]],
// CHECK-NEXT: [[instanceBoolean]] = ToBoolean [[isInstance]]
// CHECK-NEXT: Branch [[instanceBoolean]] ->
// CHECK: = Convert [[value]] declared={type=undefined|null|L{{*}}} illTypedCause=Assertion

// RUN(NOWHERE): lower
// NOWHERE-NOT: TypeTest

declare class C {
  c: number;
}

declare function isGuard(x: unknown): x is C;

enum K {
  A,
  B,
}

interface A {
  kind: K.A;
  a: number;
}

interface B {
  kind: K.B;
  b: number;
}

export function arrayTest(x: number[] | string) {
  if (Array.isArray(x)) return x.length;
  return 0;
}

export function discriminant(x: A | B) {
  if (x.kind === K.A) return x.a;
  return 0;
}

export function guard(x: unknown) {
  if (isGuard(x)) return x.c;
  return 0;
}

export function inTest(x: A | B) {
  if ("a" in x) return x.a;
  return 0;
}

export function instance(x: unknown) {
  if (x instanceof C) return x.c;
  return 0;
}
