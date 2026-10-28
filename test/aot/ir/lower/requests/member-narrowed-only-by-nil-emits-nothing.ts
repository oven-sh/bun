// RUN: lower
// CHECK-LABEL: function {{*}}name="byAnd"
// CHECK: [[andTested]] = PropGet {{*}}key="leaf"
// CHECK-NEXT: = ToBoolean [[andTested]]
// CHECK: Branch
// CHECK: [[andLeaf]] = PropGet {{*}}key="leaf"
// CHECK-NEXT: = PropGet [[andLeaf]] key="text"
// CHECK-LABEL: function {{*}}name="byComparison"
// CHECK: Branch
// CHECK: [[label]] = PropGet {{*}}key="label"
// CHECK-NEXT: [[mark]] = String
// CHECK-NEXT: = Add [[label]], [[mark]]
// CHECK-LABEL: function {{*}}name="byTruthiness"
// CHECK: [[tested]] = PropGet {{*}}key="leaf"
// CHECK-NEXT: = ToBoolean [[tested]]
// CHECK: Branch
// CHECK: [[leaf]] = PropGet {{*}}key="leaf"
// CHECK-NEXT: = PropGet [[leaf]] key="text"
// CHECK-LABEL: function {{*}}name="optionalMember"
// CHECK: Branch
// CHECK: [[next]] = PropGet {{*}}key="next"
// CHECK-NEXT: = PropGet [[next]] key="label"

// RUN(CAUSES): lower
// CAUSES-LABEL: function {{*}}name="byAnd"
// CAUSES-NOT: illTypedCause=
// CAUSES: Return
// CAUSES-LABEL: function {{*}}name="byComparison"
// CAUSES-NOT: illTypedCause=
// CAUSES: Return
// CAUSES-LABEL: function {{*}}name="byTruthiness"
// CAUSES-NOT: illTypedCause=
// CAUSES: Return
// CAUSES-LABEL: function {{*}}name="optionalMember"
// CAUSES-NOT: illTypedCause=
// CAUSES: Return

// `undefined` and `null` are members of every type that holds a reference, so `Leaf | undefined` and `Leaf` are one type in the IR. A test that only removes them leaves the read with the type of its field: it is not converted, and nothing in the function is tested. The engine's own test of the value removes them.
interface Leaf {
  text: string;
}

interface Tree {
  leaf: Leaf | undefined;
  label: string | null;
  next?: Tree;
}

export function byAnd(tree: Tree) {
  return tree.leaf && tree.leaf.text;
}

export function byComparison(tree: Tree) {
  return tree.label !== null ? tree.label + "!" : "";
}

export function byTruthiness(tree: Tree) {
  return tree.leaf ? tree.leaf.text : "";
}

export function optionalMember(tree: Tree) {
  return tree.next ? tree.next.label : null;
}
