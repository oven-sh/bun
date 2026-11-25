// RUN: link
// CHECK: layout [[item]] module={{*}}fields=[{key="name"
// CHECK: function {{*}}name="first" module={{*}}parameters=[{type=undefined|null|Array<undefined|null|string|[[item]]> flags=[OmitsNull, OmitsUndefined]}]
// CHECK: [[zero]] = Integer
// CHECK-NEXT: [[label]] = ElemGet {{*}}, [[zero]]
// CHECK-NEXT: [[mark]] = String
// CHECK-NEXT: = Add [[label]], [[mark]]
// CHECK: function {{*}}name="second" module=
// CHECK: [[one]] = Integer integer=1
// CHECK-NEXT: [[held]] = ElemGet {{*}}, [[one]]
// CHECK-NEXT: = PropGet [[held]] key="name"

// RUN(VARIABLE): lower
// VARIABLE-LABEL: function {{*}}name="underVariableIndex"
// VARIABLE-NOT: Convert
// VARIABLE: [[element]] = ElemGet
// VARIABLE-NEXT: = StrictEq [[element]],
// VARIABLE-NOT: Convert
// VARIABLE: Return

// A tuple is sent as an array of the union of its elements, which says less than the checker knows about `pair[1]`. A read of an element is converted to nothing all the same, under a constant index as under any other: the member is read from what the read gives, and the engine follows what is stored.
interface Item {
  name: string;
}

export function first(pair: [string, Item]) {
  return pair[0] + "!";
}

export function second(pair: [string, Item]) {
  return pair[1].name;
}

export function underVariableIndex(pair: [string, Item], index: number, other: string) {
  return pair[index] === other;
}
