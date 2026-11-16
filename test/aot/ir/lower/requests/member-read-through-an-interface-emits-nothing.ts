// RUN: lower
// CHECK-LABEL: function {{*}}name="declared"
// CHECK-NOT: Convert
// CHECK: [[read]] = PropGet {{*}}key="end"
// CHECK-NEXT: [[one]] = Integer integer=1
// CHECK-NEXT: = Sub [[read]], [[one]]
// CHECK-NOT: Convert
// CHECK-LABEL: function {{*}}name="narrowed"
// CHECK-NOT: Convert
// CHECK: [[tested]] = PropGet {{*}}key="mark"
// CHECK-NEXT: = TypeTest [[tested]] testedType=string
// CHECK-NOT: Convert
// CHECK: [[inside]] = PropGet {{*}}key="mark"
// CHECK-NEXT: Return [[inside]]
// CHECK-NOT: Convert


// A read of a member is converted to nothing: neither to the type that the receiver's type declares for the member nor to what the checker concludes from the
// control flow. The engine follows what is stored.
interface Span extends Array<number> {
  end: number;
  mark: number | string;
}

export function declared(span: Span) {
  return span.end - 1;
}

export function narrowed(span: Span) {
  if (typeof span.mark === "string") return span.mark;
  return "";
}
