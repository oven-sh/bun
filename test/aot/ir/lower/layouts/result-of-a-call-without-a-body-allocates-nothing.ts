// RUN: link
// `visitor.visit<Leaf>(node)` calls a member of an interface: a declaration without a body, with a written type argument. Whatever runs there is a function of the program, which
// allocates what it allocates, or code that the compiler does not see, which cannot make an object with one of the program's layouts. So the call makes no Leaf, and none of what a
// Leaf leads to: Leaf and Inner only describe objects.
// CHECK: layout {{*}}name="Leaf" {{*}}flags=[IsNeverAllocated]
// CHECK: layout {{*}}name="Inner" {{*}}flags=[IsNeverAllocated]
interface Inner {
  depth: number;
}
interface Leaf {
  inner: Inner;
  kind: number;
}
interface Visitor {
  visit<T>(node: unknown): T;
}
export function kindOf(visitor: Visitor, node: unknown): number {
  const leaf = visitor.visit<Leaf>(node);
  leaf.kind = leaf.inner.depth;
  leaf.inner.depth = 1;
  leaf.inner = leaf.inner;
  return leaf.kind;
}
