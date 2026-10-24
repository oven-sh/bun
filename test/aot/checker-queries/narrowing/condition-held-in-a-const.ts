// A condition stored in a `const` narrows references that can't have changed since: a `const`, a parameter or `let` that is never reassigned, `this`, and `readonly` properties of those. Other references keep their declared type. Nothing is narrowed if the condition is stored in a `let`, in a `const` with a type annotation, or behind more than five `const` aliases.
interface Leaf { readonly kind: "leaf"; text: string }
interface Branch { readonly kind: "branch"; children: Tree[] }
type Tree = Leaf | Branch;
interface Holder { readonly readonlyTree: Tree; mutableTree: Tree; readonly nested: { readonly leaf?: Leaf } }

function parameters(unassigned: Tree, reassigned: Tree) {
  const isUnassignedLeaf = unassigned.kind === "leaf";
  const isReassignedLeaf = reassigned.kind === "leaf";
  if (isUnassignedLeaf) {
    unassigned;
  } else {
    unassigned;
  }
  if (isReassignedLeaf) {
    reassigned;
  }
  reassigned = unassigned;
}

function locals(source: () => Tree) {
  const constant = source();
  let unassigned = source();
  let reassigned = source();
  const isConstantLeaf = constant.kind === "leaf";
  const isUnassignedLeaf = unassigned.kind === "leaf";
  const isReassignedLeaf = reassigned.kind === "leaf";
  if (isConstantLeaf) {
    constant;
  }
  if (isUnassignedLeaf) {
    unassigned;
  }
  if (isReassignedLeaf) {
    reassigned;
  }
  reassigned = constant;
}

function properties(holder: Holder) {
  const isReadonlyLeaf = holder.readonlyTree.kind === "leaf";
  const isMutableLeaf = holder.mutableTree.kind === "leaf";
  const hasNestedLeaf = holder.nested.leaf !== undefined;
  if (isReadonlyLeaf) {
    holder.readonlyTree;
  } else {
    holder.readonlyTree;
  }
  if (isMutableLeaf) {
    holder.mutableTree;
  }
  if (hasNestedLeaf) {
    holder.nested.leaf;
  } else {
    holder.nested.leaf;
  }
}

class Cursor {
  readonly current: Tree;
  next: Tree;
  constructor(current: Tree, next: Tree) {
    this.current = current;
    this.next = next;
  }
  read() {
    const isCurrentLeaf = this.current.kind === "leaf";
    const isNextLeaf = this.next.kind === "leaf";
    if (isCurrentLeaf) {
      this.current;
    } else {
      this.current;
    }
    if (isNextLeaf) {
      this.next;
    }
  }
}

function letAndAnnotatedConst(tree: Tree) {
  let isLeaf = tree.kind === "leaf";
  if (isLeaf) {
    tree;
  }
  const isBranch: boolean = tree.kind === "branch";
  if (isBranch) {
    tree;
  }
}

function bothLeaves(left: Tree, right: Tree) {
  const isLeftLeaf = left.kind === "leaf";
  const isRightLeaf = right.kind === "leaf";
  const areBothLeaves = isLeftLeaf && isRightLeaf;
  if (areBothLeaves) {
    left;
    right;
  }
}

function neitherLeaf(left: Tree, right: Tree) {
  const isLeftLeaf = left.kind === "leaf";
  const isRightLeaf = right.kind === "leaf";
  const isEitherLeaf = isLeftLeaf || isRightLeaf;
  if (!isEitherLeaf) {
    left;
    right;
  }
}

function aliasChain(tree: Tree) {
  const first = tree.kind === "leaf";
  const second = first;
  const third = second;
  const fourth = third;
  const fifth = fourth;
  const sixth = fifth;
  if (sixth) {
    tree;
  }
  if (fifth) {
    tree;
  }
}

export {};
