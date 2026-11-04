// A constructor function that makes the objects of a tagged union is called, not constructed, with an object of the caller's as `this`.
interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
function NodeMaker(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; }
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
function tellOf(n: Base): string { return String(n.kind) + " " + n.pos + " " + Object.keys(n).join() + " " + (n instanceof Node); }

function deed(other: object, kind: number): string {
  const answer = NodeMaker.call(other as Base, kind, 3);
  return String(answer) + " " + tellOf(other as Base);
}
console.log(deed({ first: 0 }, 1));
console.log(deed(new Node(2, 9), 1), deed(Object.create(null), 2).length, deed([], 1), deed(new Map(), 2));
let said = "";
for (let i = 0; i < 200; i++) said = deed(i % 3 ? { pos: -1, own: i } : new Node(i % 4, i), i % 4);
console.log(said);
const frozen = Object.freeze({ kind: 8, pos: 8 });
try { console.log(deed(frozen, 1)); } catch (error) { console.log((error as Error).name, frozen.kind, frozen.pos); }
console.log(tellOf(new Node(1, 5)), tellOf(new Node(2, 5)));
