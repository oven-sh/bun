// An object of a tagged union gets another tag of the union stored under the key of the tag, long after its constructor has returned.
interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
function NodeMaker(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; }
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
function held(n: Base): unknown { if (n.kind === 1) return (n as Num).value; if (n.kind === 2) return (n as Str).text; return "neither"; }
function tellOf(n: Base): string { return String(n.kind) + " " + n.pos + " " + Object.keys(n).join() + " " + String(held(n)); }

function deed(n: Base, kind: number): string {
  const before = tellOf(n);
  (n as { kind: number }).kind = kind;
  return before + " > " + tellOf(n);
}
const num = new Node(1, 3) as Num;
num.value = 4;
console.log(deed(num, 2));
(num as unknown as Str).text = "late";
console.log(tellOf(num), deed(num, 1), deed(num, 7), deed(num, 2));
let said = "";
for (let i = 0; i < 200; i++) {
  const n = new Node(1 + (i & 1), i);
  if (n.kind === 1) (n as Num).value = i; else (n as Str).text = "t" + i;
  said = deed(n, 2 - (i & 1));
}
console.log(said);
console.log(deed(new Node(2, 0), "1" as unknown as number), deed(new Node(1, 0), undefined as unknown as number));
