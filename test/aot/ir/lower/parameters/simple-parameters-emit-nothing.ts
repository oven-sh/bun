// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: b0([[a]]: number, [[b]]: undefined|null|string):
// CHECK-NEXT: Jump -> next [[body]]()
// CHECK-NEXT: [[body]]():
// CHECK-NEXT: Return [[a]]

// RUN(CLAIMS): lower
// CLAIMS-LABEL: function {{*}}name="f"
// CLAIMS-NOT: Convert

export function f(a: number, b: string): unknown {
  return a;
}
