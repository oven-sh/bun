// RUN: lower
// CHECK-LABEL: function {{*}}name="width"
// CHECK: parameters=[{type=undefined|null|Array<number> site=
// CHECK: [[end]] = PropGet [[list]] key="end"
// CHECK-NEXT: = Convert [[end]] declared={type=number site=w{{*}}} illTypedCause=Assertion
// CHECK: [[pos]] = PropGet [[list]] key="pos"
// CHECK-NEXT: = Convert [[pos]] declared={type=number site=w{{*}}} illTypedCause=Assertion
// CHECK: = PropGet [[list]] key="length"
// CHECK: [[element]] = ElemGet [[list]],
// CHECK-NEXT: = Convert [[element]] declared={type=number site={{*}}} illTypedCause=ContainerWriterUnseen

// RUN(STORE): lower
// STORE-LABEL: function {{*}}name="move"
// STORE: [[stored]] = Convert [[pos]] declared={type=number site=
// STORE-NEXT: PropSet [[list]], [[stored]] key="pos"

// An array has no slot for a member that an interface adds to an array type. The member is read and stored by its name, and what is read is converted to the type of the member. Elements and `length` are those of an array.
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
