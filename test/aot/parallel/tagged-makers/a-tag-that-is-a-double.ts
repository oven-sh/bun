// A constructor function that makes the objects of a tagged union is handed a number that is no integer as the tag.
interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
function NodeMaker(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; }
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
function make(kind: number, pos: number): Base { return new Node(kind, pos); }
function tellOf(n: Base): string { return typeof n.kind + " " + String(n.kind) + " " + n.pos + " " + Object.keys(n).join(); }

function deed(kind: number): string {
  return tellOf(make(kind, 3));
}
console.log(deed(1.5));
console.log(tellOf(new Node(1.5, 1)), tellOf(new Node(2.0, 1)), tellOf(new Node(NaN, 1)), tellOf(new Node(Infinity, 1)));
let said = "";
for (let i = 0; i < 200; i++) said = deed(i / 2);
console.log(said);
console.log(deed(1), deed(1.0000000000000002), deed(0.9999999999999999), deed(-Infinity), deed(1e300));
