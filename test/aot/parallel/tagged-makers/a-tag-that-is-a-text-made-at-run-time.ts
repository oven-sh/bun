// A constructor function that makes the objects of a union told apart by a text is handed a text that is put together while the program runs.
interface Base { kind: string; pos: number }
interface Num extends Base { kind: "num"; value: number }
interface Str extends Base { kind: "str"; text: string }
function NodeMaker(this: Base, kind: string, pos: number) { this.kind = kind; this.pos = pos; }
const Node = NodeMaker as unknown as new (kind: string, pos: number) => Base;
function make(kind: string, pos: number): Base { return new Node(kind, pos); }
function tellOf(n: Base): string { return typeof n.kind + " " + n.kind + " " + n.pos + " " + (n.kind === "num") + " " + Object.keys(n).join(); }

function deed(head: string, tail: string): string {
  const n = make(head + tail, 3) as Num;
  n.value = 4;
  return tellOf(n) + " " + n.value;
}
console.log(deed("n", "um"));
console.log(tellOf(new Node("n" + "um", 1)), tellOf(new Node("str", 1)), tellOf(new Node("", 1)));
const heads = ["n", "s", "x", ""];
const tails = ["um", "tr", "um", ""];
let said = "";
for (let i = 0; i < 200; i++) said = deed(heads[i % 4], tails[(i >> 2) % 4]);
console.log(said);
console.log(deed("nu", "m"), deed("st", "r"), deed("num", " "), deed("NUM".toLowerCase(), ""), deed(String.fromCharCode(110, 117), "m"), deed(["s", "t", "r"].join(""), ""));
