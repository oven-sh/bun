// RUN: link
// CHECK: layout [[node]] {{*}}fields=[{key="kind"{{*}}{key="name"{{*}}{key="parent"
// CHECK: function {{*}}name="byCondition" module={{*}}parameters=[{type=undefined|null|number|[[node]] flags=[OmitsNull, OmitsUndefined]}]
// CHECK: function {{*}}name="byKey" module={{*}}parameters=[{{*}}, {type=undefined|null|number|string|symbol flags=[OmitsNull, OmitsUndefined]}]
// CHECK: function {{*}}name="byMember" module={{*}}parameters=[{type=number}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[node]] flags=[OmitsNull]}]
// CHECK: function {{*}}name="unbounded" module={{*}}parameters=[{type=anything}]

// A type that waits for a type argument has the type of its bound: `keyof T` is a string, a number or a symbol, `T["name"]` is the member of the bound of `T`, and a conditional type is one of its two branches. The position is not only expected, so the bound is checked like a type that was written out, and it omits what the bound omits: `T["parent"]` lists `undefined` as `Node["parent"]` does. `T[K]` over a `T` without a bound has no bound itself and says nothing. What `T` itself is: type-parameter-predicts-constraint.ts.
interface Node {
  kind: number;
  name: string;
  parent: Node | undefined;
}

export function byCondition<T>(value: T extends string ? Node : number) {}

export function byKey<T extends Node>(holder: T, key: keyof T) {}

export function byMember<T extends Node>(kind: T["kind"], name: T["name"], parent: T["parent"]) {}

export function unbounded<T, K extends keyof T>(value: T[K]) {}
