// RUN: link
// CHECK: layout [[box]] kind=Instance name="Box" {{*}}fields=[{key="value" declared={type=anything} flags=[IsRequired]}]
// CHECK: layout [[holder]] {{*}}fields=[{key="value" declared={type=undefined|null|[[item]] flags=[OmitsNull, OmitsUndefined]} flags=[IsRequired]}]
// CHECK: function {{*}}name="ofInterface" module={{*}}parameters=[{type=undefined|null|[[holder]] flags=
// CHECK: function {{*}}name="ofItems" module={{*}}parameters=[{type=undefined|null|[[box]] flags=
// CHECK: [[itemRead]] = PropGet {{*}}key="value"
// CHECK-NEXT: = PropGet [[itemRead]] key="name"
// CHECK: function {{*}}name="ofNumbers" module={{*}}parameters=[{type=undefined|null|[[box]] flags=
// CHECK: [[numberRead]] = PropGet {{*}}key="value"
// CHECK-NOT: Convert
// CHECK: = Add [[numberRead]],

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

// All instantiations of a generic class have one layout, and its field has the type parameter, which says nothing. A read through `Box<Item>` or `Box<number>` is converted to nothing, inside the class as outside: the engine follows what is stored. Each instantiation of a generic interface is a layout of its own, whose field has the type argument, and a read through it emits nothing either.
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

// A method has its body once reached code reads its name.
export function readsTheNames(o: any) { return [o.holdsSame]; }
