// A constructor function that makes the objects of a tagged union stores the tag last, behind a call that looks at the object while it has no tag yet.
interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
const seen: string[] = [];
function look(n: Base): void { seen.push(String(n.kind) + " " + ("kind" in n) + " " + Object.keys(n).join()); }
function NodeMaker(this: Base, kind: number, pos: number) { this.pos = pos; look(this); this.kind = kind; }
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
function held(n: Base): unknown { if (n.kind === 1) return (n as Num).value; if (n.kind === 2) return (n as Str).text; return "neither"; }
function tellOf(n: Base): string { return String(n.kind) + " " + n.pos + " " + Object.keys(n).join() + " " + String(held(n)); }

function deed(kind: number, pos: number): string {
  const n = new Node(kind, pos);
  return seen[seen.length - 1] + " > " + tellOf(n);
}
console.log(deed(1, 3), "|", deed(2, 4), "|", deed(9, 5));
const num = new Node(1, 6) as Num;
num.value = 7;
console.log(tellOf(num), seen.length);
let said = "";
for (let i = 0; i < 200; i++) said = deed(i % 4, i);
console.log(said, seen.length);
