// A constructor function that makes the objects of a tagged union returns, for some tags, an object that it has kept or made in another way.
interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
const kept: Base[] = [];
function NodeMaker(this: Base, kind: number, pos: number): Base | void {
  this.kind = kind;
  this.pos = pos;
  if (pos < 0) return kept[kind];
  if (pos === 0) return { kind: 2, pos: 100 };
  kept[kind] = this;
}
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
function tellOf(n: Base): string { return String(n.kind) + " " + n.pos + " " + Object.keys(n).join() + " " + (n instanceof Node); }

function deed(kind: number, pos: number): string {
  return tellOf(new Node(kind, pos));
}
console.log(deed(1, 5), deed(1, -1), deed(1, 0));
console.log(new Node(1, -1) === kept[1], new Node(2, -1) === kept[2], deed(2, -1), deed(2, 6), deed(1, -1), deed(2, -1));
let said = "";
for (let i = 0; i < 200; i++) said = deed(1 + (i & 1), (i % 5) - 1);
console.log(said);
console.log(tellOf(new Node(1, 0)), tellOf(new Node(2, 7)), tellOf(kept[2]));
