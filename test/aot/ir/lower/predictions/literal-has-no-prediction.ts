// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: Convert
// CHECK: [[literal]] = Data data=
// CHECK-NEXT: Return [[literal]]

// Every element is made of literals alone, so the list is one record of data, and nothing converts it or an element.

export function f() {
  return [1 + 2, "a", { x: 1 }.x, -1, !0];
}
