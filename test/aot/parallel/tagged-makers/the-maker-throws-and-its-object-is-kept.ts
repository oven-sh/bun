// A constructor function that makes the objects of a tagged union hands its object out and then throws, in front of the store of the tag or behind it: what was handed out is used all the same.
interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
const kept: Base[] = [];
function NodeMaker(this: Base, kind: number, pos: number) {
  kept.push(this);
  if (pos < 0) throw new RangeError("in front " + pos);
  this.kind = kind;
  this.pos = pos;
  if (pos === 0) throw new RangeError("behind " + kind);
}
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
function held(n: Base): unknown { if (n.kind === 1) return (n as Num).value; if (n.kind === 2) return (n as Str).text; return "neither"; }
function tellOf(n: Base): string { return String(n.kind) + " " + n.pos + " [" + Object.keys(n).join() + "] " + String(held(n)) + " " + (n instanceof Node); }

function deed(kind: number, pos: number): string {
  try { return tellOf(new Node(kind, pos)); } catch (error) { return (error as Error).message + " > " + tellOf(kept[kept.length - 1]); }
}
console.log(deed(1, 5), "|", deed(1, 0), "|", deed(1, -1), "|", deed(2, 0), "|", deed(9, -2));
const half = kept[2] as Num;
half.value = 4;
half.kind = 1;
console.log(tellOf(half));
let said = "";
for (let i = 0; i < 200; i++) said = deed(1 + (i & 1), (i % 3) - 1);
console.log(said, kept.length);
