// The class whose constructor makes the objects of a tagged union is evaluated twice: each evaluation has a prototype object of its own, below which its objects stand whatever their tag.
interface Base { kind: number; pos: number; who(): string }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
function define(name: string) {
  return class NodeObject {
    declare kind: number;
    declare pos: number;
    constructor(kind: number, pos: number) { this.kind = kind; this.pos = pos; }
    who(): string { return name + " " + this.kind; }
  };
}
function tellOf(n: Base): string { return String(n.kind) + " " + n.pos + " " + Object.keys(n).join() + " " + n.who(); }

function deed(name: string) {
  return define(name);
}
const First = deed("first");
console.log(tellOf(new First(1, 1)), tellOf(new First(2, 1)), tellOf(new First(9, 1)));
let said = "";
for (let i = 0; i < 200; i++) said = tellOf(new First(i % 4, i));
console.log(said);
const Second = deed("second");
console.log(tellOf(new Second(1, 2)), tellOf(new First(1, 2)), String(new Second(1, 2) instanceof First), String(new Second(2, 2) instanceof Second), String(Object.getPrototypeOf(new Second(1, 0)) === Second.prototype));
for (let i = 0; i < 200; i++) said = tellOf(new (i & 1 ? First : Second)(i % 4, i));
console.log(said);
