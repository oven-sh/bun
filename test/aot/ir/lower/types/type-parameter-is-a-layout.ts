// RUN: link
// CHECK: layout {{*}}kind=Instance name="Box" {{*}}fields=[{key="value" declared={type=undefined|null|[[t]] site=[[field]]} flags=[IsRequired]}]
// CHECK: layout [[t]] flags=[IsTypeParameter, IsNeverAllocated]
// CHECK: function {{*}}name="Box" module={{*}}parameters=[{type=undefined|null|[[t]] site=[[parameter]]}]

// RUN(BOUND): link
// BOUND: layout [[node]] name="Node"
// BOUND: layout [[t]] supertypes=[{{*}}[[node]]] flags=[IsTypeParameter, IsNeverAllocated]
// BOUND: function {{*}}name="bounded" module={{*}}parameters=[{type=undefined|null|[[t]] site=[[first]]}, {type=undefined|null|Array<undefined|null|[[t]]> site=[[second]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[t]] site=[[result]]}]

// RUN(PAIR): lower
// PAIR-LABEL: function {{*}}name="pair"
// PAIR: parameters=[{type=undefined|null|[[a]] site=
// PAIR-NOT: type=undefined|null|[[a]] site=
// PAIR: results=[{type=undefined|null|[[a]] site=

// A type parameter of a compiled file is a layout that nobody allocates: no name, no fields, and the flag. A field, a parameter, the contents of an array and a result that are written `T` have that layout as their type, with a site and no flag, so they are checked like any other position. A bound puts the layout below the layout of the bound. Each type parameter has a layout of its own: the second parameter of `pair` doesn't have the type of the first, the result does.
interface Node {
  kind: number;
}

export class Box<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }
}

export function bounded<T extends Node>(node: T, list: T[]): T {
  return node;
}

export function pair<A, B>(first: A, second: B): A {
  return first;
}
