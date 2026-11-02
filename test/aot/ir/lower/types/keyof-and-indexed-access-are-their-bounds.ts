// RUN: link
// CHECK: layout [[node]] name="Node"
// CHECK: function {{*}}name="byCondition" module={{*}}parameters=[{type=undefined|null|number|[[node]] site=[[value]]}]
// CHECK: function {{*}}name="byKey" module={{*}}parameters=[{type=undefined|null|[[t]] site=[[holder]]}, {type=undefined|null|number|string|symbol site=[[key]]}]
// CHECK: function {{*}}name="byMember" module={{*}}parameters=[{type=number site=[[kind]]}, {type=undefined|null|string site=[[name]]}, {type=undefined|null|[[node]] site=[[parent]]}]
// CHECK: function {{*}}name="unbounded" module={{*}}parameters=[{type=anything}]

// A type that waits for a type argument has the type of its bound: `keyof T` is a string, a number or a symbol, `T["name"]` is the member of the bound of `T`, and a conditional type is one of its two branches. The position has a site and no flag, so the bound is checked like a type that was written out. `T[K]` over a `T` without a bound has no bound itself and says nothing.
interface Node {
  kind: number;
  name: string;
  parent: Node | undefined;
}

export function byCondition<T>(value: T extends string ? Node : number) {}

export function byKey<T extends Node>(holder: T, key: keyof T) {}

export function byMember<T extends Node>(kind: T["kind"], name: T["name"], parent: T["parent"]) {}

export function unbounded<T, K extends keyof T>(value: T[K]) {}
