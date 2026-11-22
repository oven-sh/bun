// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: Branch {{*}}notTaken [[front]](
// CHECK: [[front]](
// CHECK-NEXT: Jump -> next [[covered]]()
// CHECK: [[covered]]() handler=

declare function use(value: unknown): void;

export function f(n: number) {
  let said = "";
  for (let i = 0; i < n; i++) said += i;
  try {
    use(said);
  } catch {}
  return said;
}
