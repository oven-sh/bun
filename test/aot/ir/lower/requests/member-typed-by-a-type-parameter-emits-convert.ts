// RUN: link
// CHECK: layout [[item]] name="Item"
// CHECK: function {{*}}name="ofItems" module=
// CHECK: [[itemRead]] = PropGet {{*}}key="value"
// CHECK-NEXT: [[held]] = Convert [[itemRead]] declared={type=undefined|null|[[item]] site=w{{*}}} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[held]] key="name"
// CHECK: function {{*}}name="ofNumbers" module=
// CHECK: [[numberRead]] = PropGet {{*}}key="value"
// CHECK-NEXT: [[number]] = Convert [[numberRead]] declared={type=number site=w{{*}}} illTypedCause=Assertion
// CHECK: = Add [[number]],

// RUN(INTERFACE): lower
// INTERFACE-LABEL: function {{*}}name="ofInterface"
// INTERFACE-NOT: illTypedCause=
// INTERFACE: [[argument]] = PropGet {{*}}key="value"
// INTERFACE-NEXT: = PropGet [[argument]] key="name"
// INTERFACE-NOT: illTypedCause=
// INTERFACE: Return

// RUN(INSIDE): lower
// INSIDE-LABEL: function {{*}}name="holdsSame"
// INSIDE: [[mine]] = PropGet {{*}}key="value"
// INSIDE-NEXT: [[theirs]] = PropGet {{*}}key="value"
// INSIDE-NEXT: = StrictEq [[mine]], [[theirs]]

// All instantiations of a generic class have one layout, and its field has the type parameter. Read through `Box<Item>` the checker's type of the member is `Item`, which the field does not say, so the read is converted to it and the engine tests it. Inside the class the member has the type of the field and is used as it is. Each instantiation of a generic interface is a layout of its own, whose field has the type argument, so a read through it emits nothing.
interface Item {
  name: string;
}

interface Holder<T> {
  value: T;
}

export class Box<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }

  holdsSame(other: Box<T>) {
    return this.value === other.value;
  }
}

export function ofInterface(holder: Holder<Item>) {
  return holder.value.name;
}

export function ofItems(box: Box<Item>) {
  return box.value.name;
}

export function ofNumbers(box: Box<number>) {
  return box.value + 1;
}
