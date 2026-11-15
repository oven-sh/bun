// A constructor function that makes the objects of a tagged union is handed a tag that no interface of the union declares.
interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
function NodeMaker(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; }
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
function make(kind: number, pos: number): Base { return new Node(kind, pos); }
function tellOf(n: Base): string { return typeof n.kind + " " + String(n.kind) + " " + n.pos + " " + Object.keys(n).join(); }

function deed(kind: number): string {
  const n = make(kind, 3) as Num;
  n.value = 4;
  return tellOf(n) + " " + n.value;
}
console.log(deed(7));
console.log(tellOf(new Node(7, 1)), tellOf(new Node(1, 1)));
let said = "";
for (let i = 0; i < 200; i++) said = deed(i % 9);
console.log(said);
console.log(deed(1), deed(2), deed(0), deed(-1), deed(4294967297));
