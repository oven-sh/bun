// RUN: link
// CHECK: layout [[item]] name="Item"
// CHECK: function {{*}}name="first" module=
// CHECK: [[zero]] = Integer
// CHECK-NEXT: [[firstElement]] = ElemGet {{*}}, [[zero]]
// CHECK-NEXT: [[label]] = Convert [[firstElement]] declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK: = Add [[label]],
// CHECK: function {{*}}name="second" module=
// CHECK: [[one]] = Integer integer=1
// CHECK-NEXT: [[secondElement]] = ElemGet {{*}}, [[one]]
// CHECK-NEXT: [[held]] = Convert [[secondElement]] declared={type=undefined|null|[[item]]} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[held]] key="name"

// RUN(VARIABLE): lower
// VARIABLE-LABEL: function {{*}}name="underVariableIndex"
// VARIABLE-NOT: illTypedCause=
// VARIABLE: [[element]] = ElemGet
// VARIABLE-NEXT: = StrictEq [[element]],
// VARIABLE-NOT: illTypedCause=
// VARIABLE: Return

// A tuple is sent as an array of the union of its elements, which says less than the checker knows about `pair[1]`. Under a constant index the read is a reference, so it is converted to the checker's type of that element, and the member is read from the converted value. Under any other index the checker has the union too, the read is no reference, and nothing is emitted.
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
