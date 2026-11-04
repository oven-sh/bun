// A class extends the constructor function that makes the objects of a tagged union, and is constructed with the tags of the union.
interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
function NodeMaker(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; }
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
class Below extends Node {
  declare below: string;
  constructor(kind: number, pos: number) { super(kind, pos); this.below = "b" + kind; }
  who(): string { return "below " + this.kind; }
}
function tellOf(n: Base): string { return String(n.kind) + " " + n.pos + " " + Object.keys(n).join() + " " + (n instanceof Node) + " " + (n instanceof Below); }

function deed(kind: number): string {
  const b = new Below(kind, 3);
  return tellOf(b) + " " + b.who() + " " + tellOf(new Node(kind, 4));
}
console.log(deed(1));
console.log(deed(2), deed(9));
let said = "";
for (let i = 0; i < 200; i++) said = deed(i % 4);
console.log(said);
console.log(Object.getPrototypeOf(Below) === Node, Object.getPrototypeOf(Below.prototype) === NodeMaker.prototype, tellOf(Reflect.construct(Node, [1, 5], Below)));
