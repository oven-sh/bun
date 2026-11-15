// RUN: lower
// CHECK-LABEL: function {{*}}name="discriminant"
// CHECK: = PropGet [[union]] key="kind"
// CHECK: [[sameKind]] = StrictEq
// CHECK-NEXT: Branch [[sameKind]] -> taken [[kindTaken]](| 0), notTaken {{*}}(| 0)
// CHECK: [[kindTaken]]([[kindRead]]):
// CHECK-NEXT: [[narrowedUnion]] = NarrowByField [[union]], [[kindRead]] key="kind"
// CHECK-NOT: = Convert
// CHECK: = PropGet [[narrowedUnion]] key="a"
// CHECK-LABEL: function {{*}}name="guard"
// CHECK: = Call {{*}}, [[guarded]] calleeName="isGuard"
// CHECK: [[isGuarded]] = ToBoolean
// CHECK-NEXT: Branch [[isGuarded]] ->
// CHECK-NOT: = Convert
// CHECK: = PropGet [[guarded]] key="c"
// CHECK-LABEL: function {{*}}name="inTest"
// CHECK: [[has]] = PropHas [[holder]] key="a"
// CHECK-NEXT: [[hasBoolean]] = ToBoolean [[has]]
// CHECK-NEXT: Branch [[hasBoolean]] ->
// CHECK-NOT: = Convert
// CHECK: = PropGet [[holder]] key="a"
// CHECK-LABEL: function {{*}}name="instance"
// CHECK: [[isInstance]] = InstanceOf [[value]],
// CHECK-NEXT: [[instanceBoolean]] = ToBoolean [[isInstance]]
// CHECK-NEXT: Branch [[instanceBoolean]] ->
// CHECK-NOT: = Convert
// CHECK: = PropGet [[value]] key="c"

// RUN(NOWHERE): lower
// NOWHERE-NOT: TypeTest

// No narrowed type is written behind such a test: the read takes the value that was tested, or what NarrowByField makes of it. `Array.isArray(local)`: is-array-looks-at-the-cell-first.ts.

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
