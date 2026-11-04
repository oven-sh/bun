// The property that tells the objects of a tagged union apart is deleted from one of them.
interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
function NodeMaker(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; }
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
function held(n: Base): unknown { if (n.kind === 1) return (n as Num).value; if (n.kind === 2) return (n as Str).text; return "neither"; }
function tellOf(n: Base): string { return String(n.kind) + " " + ("kind" in n) + " " + n.pos + " " + Object.keys(n).join() + " " + String(held(n)); }

function deed(n: Base): string {
  const before = tellOf(n);
  const answer = delete (n as Partial<Base>).kind;
  return before + " > " + answer + " " + tellOf(n);
}
const num = new Node(1, 3) as Num;
num.value = 4;
console.log(deed(num));
(num as { kind: number }).kind = 1;
console.log(tellOf(num), deed(num), deed(num));
let said = "";
for (let i = 0; i < 200; i++) said = deed(new Node(i % 4, i));
console.log(said);
(NodeMaker.prototype as any).kind = 2;
const bare = new Node(1, 8) as unknown as Str;
bare.text = "from above";
console.log(deed(bare), tellOf(new Node(1, 9)));
