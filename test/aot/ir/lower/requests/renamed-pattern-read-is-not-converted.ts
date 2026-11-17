// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: Convert
// CHECK: [[read]] = PropGet [[receiver]] key="a"
// CHECK-NEXT: Return [[read]]

// What a pattern takes out under another name is converted to nothing: the name holds the read as it is.
export function f(r: { a: number }) {
  const { a: first } = r;
  return first;
}
