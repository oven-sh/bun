// A constructor function that makes the objects of a tagged union returns, for some arguments, before it has stored the tag: the object has what was stored and nothing else.
interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
function NodeMaker(this: Base, kind: number, pos: number) { if (pos < 0) return; this.pos = pos; if (pos === 0) return; this.kind = kind; }
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
function held(n: Base): unknown { if (n.kind === 1) return (n as Num).value; if (n.kind === 2) return (n as Str).text; return "neither"; }
function tellOf(n: Base): string { return String(n.kind) + " " + n.pos + " " + ("kind" in n) + " [" + Object.keys(n).join() + "] " + String(held(n)); }

function deed(kind: number, pos: number): string {
  return tellOf(new Node(kind, pos));
}
console.log(deed(1, 5), "|", deed(1, 0), "|", deed(1, -1), "|", deed(2, 0), "|", deed(9, -1));
const bare = new Node(1, -1) as Num;
bare.value = 3;
console.log(tellOf(bare));
bare.kind = 1;
bare.pos = 8;
console.log(tellOf(bare));
let said = "";
for (let i = 0; i < 200; i++) said += deed(1 + (i & 1), (i % 3) - 1).length;
console.log(said.length, deed(2, 7), "|", deed(2, -7));
