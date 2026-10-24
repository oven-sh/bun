// (1) Inner functions that capture values beside their scope. (2) A scope that runs once and holds a constructor function whose objects are told apart by a tag.
const turns = Number(process.argv[3] ?? 20000);
const which = process.argv[2] ?? "all";

// `limit`, `label`, `weights` are never assigned: they are captured as values. `count` lies in the scope.
function walk(seed: number, weights: number[], label: string, depth: number): number {
  let count = seed;
  const limit = weights.length;
  function bump(by: number): number {
    count += by;
    return count;
  }
  // Calls itself, so it is not taken in whole; reads one of its three captured values on a rare path only.
  function descend(level: number): number {
    if (level <= 0) return bump(1);
    if (count < -1000000) return label.length + limit;
    return descend(level - 1) + visit(level);
  }
  function visit(level: number): number {
    if (level <= 1) return bump(weights[level & 3]);
    return descend(level - 2) + limit;
  }
  // Nobody calls it.
  function describe(): string {
    return label + count + weights.length;
  }
  return descend(depth) + visit(depth);
}

const tagged = (() => {
  let made = 0;
  function count(): void {
    made++;
  }
  const enum Kind {
    Name = 1,
    Call = 2,
  }
  interface Node {
    kind: Kind;
    pos: number;
  }
  interface Name extends Node {
    kind: Kind.Name;
    text: string;
  }
  interface Call extends Node {
    kind: Kind.Call;
    callee: Node;
  }
  function TaggedNode(this: Node, kind: Kind, pos: number) {
    this.kind = kind;
    this.pos = pos;
    count();
  }
  const NodeConstructor = TaggedNode as unknown as new (kind: Kind, pos: number) => Node;
  function createName(text: string, pos: number): Name {
    const node = new NodeConstructor(Kind.Name, pos) as Name;
    node.text = text;
    return node;
  }
  function createCall(callee: Node): Call {
    const node = new NodeConstructor(Kind.Call, callee.pos) as Call;
    node.callee = callee;
    return node;
  }
  return { createName, createCall, made: () => made };
})();

const plain = (() => {
  let made = 0;
  function countPlain(): void {
    made++;
  }
  interface Node {
    kind: number;
    pos: number;
    text?: string;
    callee?: Node;
  }
  function PlainNode(this: Node, kind: number, pos: number) {
    this.kind = kind;
    this.pos = pos;
    countPlain();
  }
  const NodeConstructor = PlainNode as unknown as new (kind: number, pos: number) => Node;
  function createName(text: string, pos: number): Node {
    const node = new NodeConstructor(1, pos);
    node.text = text;
    return node;
  }
  function createCall(callee: Node): Node {
    const node = new NodeConstructor(2, callee.pos);
    node.callee = callee;
    return node;
  }
  return { createName, createCall, made: () => made };
})();

let total = 0;
if (which === "all" || which === "walk") {
  const weights = [1, 2, 3, 4];
  for (let i = 0; i < turns; i++) total += walk(i, weights, "w", 6);
}
if (which === "all" || which === "tagged") {
  for (let i = 0; i < turns; i++) total += tagged.createCall(tagged.createName("n", i)).pos;
  total += tagged.made();
}
if (which === "all" || which === "plain") {
  for (let i = 0; i < turns; i++) total += plain.createCall(plain.createName("n", i)).pos;
  total += plain.made();
}
console.log(total);
