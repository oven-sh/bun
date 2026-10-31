// RUN: lower
// CHECK-LABEL: function {{*}}name="chain"
// CHECK: [[inner]] = PropGet {{*}}key="inner"
// CHECK-NEXT: [[count]] = PropGet [[inner]] key="count"
// CHECK-NEXT: [[one]] = Integer integer=1
// CHECK-NEXT: = Add [[count]], [[one]]
// CHECK-LABEL: function {{*}}name="optional"
// CHECK: [[limit]] = PropGet {{*}}key="limit"
// CHECK-NEXT: = TypeTest [[limit]] testedType=undefined|null
// CHECK-LABEL: function {{*}}name="single"
// CHECK: [[label]] = PropGet {{*}}key="label"
// CHECK-NEXT: [[mark]] = String
// CHECK-NEXT: = Add [[label]], [[mark]]
// CHECK-LABEL: function {{*}}name="underConstantKey"
// CHECK: [[keyed]] = PropGet {{*}}key="inner"
// CHECK-NEXT: = PropGet [[keyed]] key="count"

// RUN(CAUSES): lower
// CAUSES-LABEL: function {{*}}name="chain"
// CAUSES-NOT: illTypedCause=
// CAUSES: Return
// CAUSES-LABEL: function {{*}}name="optional"
// CAUSES-NOT: illTypedCause=
// CAUSES: Return
// CAUSES-LABEL: function {{*}}name="single"
// CAUSES-NOT: illTypedCause=
// CAUSES: Return
// CAUSES-LABEL: function {{*}}name="underConstantKey"
// CAUSES-NOT: illTypedCause=
// CAUSES: Return

// RUN(THIS): lower
// THIS-LABEL: function {{*}}name="ofThis"
// THIS-NOT: illTypedCause=
// THIS: [[innerOfThis]] = PropGet {{*}}key="inner"
// THIS-NEXT: [[countOfThis]] = PropGet [[innerOfThis]] key="count"
// THIS-NEXT: [[oneMore]] = Integer integer=1
// THIS-NEXT: = Add [[countOfThis]], [[oneMore]]
// THIS-NOT: illTypedCause=
// THIS: Return

// The slot of a field holds what the type of the field says. Where the checker's type of a read is that type, nothing is left to say: the read is used as it is, and nothing in the function is tested. That holds for a member of a variable, of another member and of `this`, under a name and under a constant key, and for an optional member, whose field lists `undefined` as the read does.
interface Inner {
  count: number;
}

interface Outer {
  inner: Inner;
  label: string;
  limit?: number;
}

export class Holder {
  inner: Inner = { count: 0 };

  ofThis() {
    return this.inner.count + 1;
  }
}

export function chain(outer: Outer) {
  return outer.inner.count + 1;
}

export function optional(outer: Outer) {
  return outer.limit ?? 0;
}

export function single(outer: Outer) {
  return outer.label + "!";
}

export function underConstantKey(outer: Outer) {
  return outer["inner"].count;
}
