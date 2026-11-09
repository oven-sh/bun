// RUN: lower
// CHECK-LABEL: function {{*}}name="early"
// CHECK: PutEnvironmentField

// One call stands in front of `const stack`: it throws where `walk` reads the name. So the name is looked at where it lies, and is not handed over.
export function early(t: number): number {
  if (t < 0) return walk(t);
  const stack: number[] = [];
  return walk(t);
  function walk(n: number): number {
    stack.push(n);
    return n ? walk(n - 1) : stack.length;
  }
}
