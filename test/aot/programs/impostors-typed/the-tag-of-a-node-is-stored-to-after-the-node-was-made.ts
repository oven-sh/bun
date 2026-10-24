enum Kind {
  Leaf,
  Pair,
  Name,
}

interface Leaf {
  kind: Kind.Leaf;
  value: number;
}

interface Pair {
  kind: Kind.Pair;
  left: Tree;
  right: Tree;
}

interface Name {
  kind: Kind.Name;
  text: string;
}

type Tree = Leaf | Pair | Name;

class TreeObject {
  kind: Kind;
  constructor(kind: Kind) {
    this.kind = kind;
  }
}

function make(kind: Kind): Tree {
  return new TreeObject(kind) as unknown as Tree;
}

function leaf(value: number): Leaf {
  const made = make(Kind.Leaf) as Leaf;
  made.value = value;
  return made;
}

function pair(left: Tree, right: Tree): Pair {
  const made = make(Kind.Pair) as Pair;
  made.left = left;
  made.right = right;
  return made;
}

function named(text: string): Name {
  const made = make(Kind.Name) as Name;
  made.text = text;
  return made;
}

function describe(tree: Tree): string {
  switch (tree.kind) {
    case Kind.Leaf:
      return "leaf " + tree.value;
    case Kind.Pair:
      return (
        "pair (" +
        (tree.left ? describe(tree.left) : String(tree.left)) +
        ", " +
        (tree.right ? describe(tree.right) : String(tree.right)) +
        ")"
      );
    case Kind.Name:
      return "name " + tree.text;
  }
  return "no kind " + String((tree as { kind: unknown }).kind);
}

function total(tree: Tree): number {
  if (tree.kind === Kind.Leaf) return tree.value;
  if (tree.kind === Kind.Pair) return total(tree.left) + total(tree.right);
  return tree.text.length;
}

function show(label: string, tree: Tree) {
  let sum: string;
  try {
    sum = String(total(tree));
  } catch (error) {
    sum = "threw " + (error as Error).constructor.name;
  }
  console.log(
    label + ":",
    describe(tree),
    "| total",
    sum,
    "| keys",
    Object.keys(tree).join(),
    "| json",
    JSON.stringify(tree),
  );
}

let grown: Tree = leaf(0);
for (let i = 1; i <= 2000; i++) grown = i % 3 ? pair(leaf(i), named("n")) : leaf(i);
show("after 2000 honest nodes", grown);

const retagged = leaf(7);
show("a leaf", retagged);
(retagged as { kind: Kind }).kind = Kind.Name;
show("the leaf with the tag of a name", retagged);
(retagged as unknown as Name).text = "late";
show("and with a text", retagged);
(retagged as { kind: Kind }).kind = Kind.Pair;
show("the same with the tag of a pair", retagged);
(retagged as unknown as Pair).left = leaf(1);
(retagged as unknown as Pair).right = named("xy");
show("and with both sides", retagged);
(retagged as { kind: Kind }).kind = Kind.Leaf;
show("and a leaf again", retagged);

const byName = pair(leaf(1), leaf(2));
const key = JSON.parse('"kind"') as "kind";
(byName as { kind: Kind })[key] = Kind.Leaf;
show("a pair whose tag is stored under a computed name", byName);

const outside = make(99 as Kind);
show("a tag that no member has", outside);
(outside as { kind: Kind }).kind = Kind.Leaf;
show("which then becomes a leaf without a value", outside);

const fraction = make(0.5 as Kind);
show("a tag that is a fraction", fraction);

const text = make("1" as unknown as Kind);
show("a tag that is a string", text);

const removed = named("gone");
delete (removed as { kind?: Kind }).kind;
show("a name without its tag", removed);

const computed = named("getter");
let reads = 0;
Object.defineProperty(computed, "kind", {
  get() {
    return reads++ % 2 ? Kind.Leaf : Kind.Name;
  },
  enumerable: true,
});
show("a tag that a getter answers differently each time", computed);
console.log("the getter ran", reads, "times");

class Subtree extends TreeObject {
  extra = "x";
}
const below = new Subtree(Kind.Leaf) as unknown as Leaf;
below.value = 3;
show("an instance of a class below", below);
show("an honest pair again", pair(leaf(1), named("abc")));
