// The constructor of a class makes the objects of a tagged union, and is constructed for itself, for a class below it and, by Reflect.construct, for a function that has nothing to do with it.
interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
class NodeObject implements Base {
  declare kind: number;
  declare pos: number;
  constructor(kind: number, pos: number) { this.kind = kind; this.pos = pos; }
  who(): string { return "node " + this.kind; }
}
class Below extends NodeObject {
  declare below: boolean;
  constructor(kind: number, pos: number) { super(kind, pos); this.below = true; }
  who(): string { return "below " + this.kind; }
}
function Other(this: any) { }
Other.prototype.who = function () { return "other"; };
function make(kind: number, pos: number): Base { return new NodeObject(kind, pos); }
function tellOf(n: any): string { return String(n.kind) + " " + n.pos + " " + Object.keys(n).join() + " " + n.who() + " " + (n instanceof NodeObject) + " " + (n instanceof Below); }

function deed(kind: number, way: number): string {
  if (way === 0) return tellOf(make(kind, 3));
  if (way === 1) return tellOf(new Below(kind, 3));
  if (way === 2) return tellOf(Reflect.construct(NodeObject, [kind, 3], Other));
  return tellOf(Reflect.construct(NodeObject, [kind, 3], Below));
}
console.log(deed(1, 0), deed(1, 1), deed(1, 2), deed(1, 3));
console.log(tellOf(new NodeObject(1, 1)), tellOf(new NodeObject(2, 1)), tellOf(new NodeObject(9, 1)), tellOf(new NodeObject(1.5, 1)));
let said = "";
for (let i = 0; i < 240; i++) said = deed(i % 4, (i >> 2) % 4);
console.log(said);
const num = make(1, 5) as Num;
num.value = 6;
console.log(tellOf(num), String(num.value));
