// RUN: lower
// CHECK-LABEL: function {{*}}name="ofClass"
// CHECK-NOT: Convert
// CHECK: [[element]] = PropGet {{*}}key="value"
// CHECK-NEXT: = PropGet [[element]] key="label"
// CHECK: [[box]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: [[result]] = PropGet [[box]] key="value"
// CHECK-NEXT: = PropGet [[result]] key="label"
// CHECK: [[other]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: [[answer]] = PropGet [[other]] key="latest"
// CHECK-NEXT: = PropGet [[answer]] key="label"
// CHECK-LABEL: function {{*}}name="ofPlainClass"
// CHECK-NOT: Convert
// CHECK: [[element]] = PropGet {{*}}key="value"
// CHECK-NEXT: = PropGet [[element]] key="label"
// CHECK: [[plain]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: [[held]] = PropGet [[plain]] key="value"
// CHECK-NEXT: = PropGet [[held]] key="label"
// CHECK-LABEL: function {{*}}name="Box"

// A read of a member is converted to nothing, also where the slot or the accessor is written `T` and the type of the receiver says what stands in its place: all instantiations of `Box` have one layout, and the engine follows what is stored. Only what `make()` answers goes with a guess: nobody here knows who is called.
interface Item {
  label: string;
}

export class Box<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }

  get latest(): T {
    return this.value;
  }
}

export class Plain {
  value: Item;

  constructor(value: Item) {
    this.value = value;
  }
}

export function ofClass(boxes: Box<Item>[], at: number, make: () => Box<Item>) {
  return [boxes[at].value.label, make().value.label, make().latest.label];
}

export function ofPlainClass(list: Plain[], at: number, make: () => Plain) {
  return [list[at].value.label, make().value.label];
}
