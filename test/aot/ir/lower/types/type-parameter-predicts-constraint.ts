// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=undefined|null|[[node]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|Array<undefined|null|[[node]]> flags=[OmitsNull, OmitsUndefined]}]
// CHECK: ([[n]]: undefined|null|[[node]],
// CHECK: = PropGet [[n]] key="kind"
// CHECK-NOT: illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="g"
// CHECK: parameters=[{type=anything}]
// CHECK-LABEL: function {{*}}name="h"
// CHECK: parameters=[{type=undefined|null|[[node]] flags=[OmitsNull, OmitsUndefined]}]
// CHECK-LABEL: function {{*}}name="i"
// CHECK: parameters=[{type=number}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[node]] flags=[OmitsNull, OmitsUndefined]}]
// CHECK-LABEL: function {{*}}name="j"
// CHECK: parameters=[{type=undefined|null|Array<undefined|null|Array> flags=[OmitsNull, OmitsUndefined]}]
// CHECK-LABEL: function {{*}}name="k"
// CHECK: parameters=[{type=undefined|null|[[ordered]] flags=[OmitsNull, OmitsUndefined]}]
// CHECK: ([[x]]: undefined|null|[[ordered]])
// CHECK: = PropGet [[x]] key="after"
// CHECK-NOT: illTypedCause=Assertion

// `T extends Node`: whatever a call puts in the place of `T` is a Node, so inside `f` a position that is written `T` has the type of the bound and is tested like the parameter of `h`, and a member that is read off it is in the slot of a Node, which says its type by itself. A bound that is itself a type parameter leads on to its own bound. A bound may name its own type parameter: as the contents of a list it says nothing the second time round, and as a member of an object type it is the layout of that type. Without a bound `T` says nothing.
interface Node {
  kind: number;
}

interface Ordered<T> {
  after: T;
}

export function f<T extends Node>(n: T, m: T[]) {
  return n.kind;
}

export function g<T>(n: T) {}

export function h(n: Node) {}

export function i<N extends number, S extends string, U extends T, T extends Node>(n: N, s: S, u: U) {}

export function j<T extends T[]>(x: T) {}

export function k<T extends Ordered<T>>(x: T) {
  return x.after;
}
