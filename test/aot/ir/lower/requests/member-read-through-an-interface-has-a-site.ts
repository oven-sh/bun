// RUN: lower
// CHECK-LABEL: function {{*}}name="declared"
// CHECK: [[read]] = PropGet {{*}}key="end"
// CHECK-NEXT: = Convert [[read]] declared={type=number site=w{{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="narrowed"
// CHECK: = PropGet {{*}}key="mark"
// CHECK: [[inside]] = PropGet {{*}}key="mark"
// CHECK-NEXT: = Convert [[inside]] declared={type=undefined|null|string} illTypedCause=Assertion

// RUN(SITE): link
// SITE: typesite w{{*}} module=m0 position={{*}} kind=PropertyRead

// The type that the receiver's type declares for a member is written in the program, like that of a field: the conversion says where. What the checker concludes
// from the control flow is written nowhere.
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
