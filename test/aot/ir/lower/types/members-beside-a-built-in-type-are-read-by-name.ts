// RUN: lower
// CHECK-LABEL: function {{*}}name="width"
// CHECK: parameters=[{type=undefined|null|Array<number>
// CHECK: [[end]] = PropGet [[list]] key="end"
// CHECK-NEXT: [[pos]] = PropGet [[list]] key="pos"
// CHECK-NEXT: = Sub [[end]], [[pos]]
// CHECK-NEXT: = PropGet [[list]] key="length"
// CHECK: [[element]] = ElemGet [[list]],
// CHECK-NEXT: = Add {{*}}, [[element]]

// RUN(STORE): lower
// STORE-LABEL: function {{*}}name="move"
// STORE-NEXT: ([[list]]: {{*}}, [[pos]]:
// STORE: PropSet [[list]], [[pos]] key="pos"

// An array has no slot for a member that an interface adds to an array type. The member is read and stored by its name, and neither the read nor the store is converted. Elements and `length` are those of an array.
interface NodeArray<T> extends ReadonlyArray<T> {
  pos: number;
  end: number;
}

export function width(list: NodeArray<number>): number {
  return list.end - list.pos + list.length + list[0];
}

export function move(list: NodeArray<number>, pos: number) {
  list.pos = pos;
}
