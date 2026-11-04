// A constructor function that makes the objects of a tagged union, one of whose tags is 0, is handed -0 as the tag.
interface Base { kind: number; pos: number }
interface Zero extends Base { kind: 0; value: number }
interface One extends Base { kind: 1; text: string }
function NodeMaker(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; }
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
function make(kind: number, pos: number): Base { return new Node(kind, pos); }
function tellOf(n: Base): string { return (Object.is(n.kind, -0) ? "-0" : String(n.kind)) + " " + n.pos + " " + (n.kind === 0) + " " + Object.keys(n).join(); }

function deed(kind: number): string {
  const n = make(kind, 3) as Zero;
  n.value = 5;
  return tellOf(n) + " " + 1 / n.kind;
}
console.log(deed(-0));
console.log(tellOf(new Node(-0, 1)), tellOf(new Node(0, 1)));
let said = "";
for (let i = 0; i < 200; i++) said = deed(i % 2 ? -0 : 0) + said.slice(0, 0);
console.log(said);
console.log(deed(0), deed(-0), deed(0 * -1), deed(1));
