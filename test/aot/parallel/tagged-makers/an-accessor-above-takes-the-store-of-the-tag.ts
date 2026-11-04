// The prototype object of a constructor function that makes the objects of a tagged union gets an accessor under the key of the tag: the store in the constructor runs the setter, and the object has no tag of its own.
interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
function NodeMaker(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; }
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
function held(n: Base): unknown { if (n.kind === 1) return (n as Num).value; if (n.kind === 2) return (n as Str).text; return "neither"; }
function tellOf(n: Base): string { return String(n.kind) + " " + n.pos + " " + Object.keys(n).join() + " " + String(held(n)); }

const taken: number[] = [];
function deed(): void {
  Object.defineProperty(NodeMaker.prototype, "kind", { get() { return 2; }, set(value: number) { taken.push(value); }, configurable: true });
}
const early = new Node(1, 1) as Num;
early.value = 5;
let said = "";
for (let i = 0; i < 200; i++) said = tellOf(new Node(1 + (i & 1), i));
console.log(tellOf(early), "|", said, "|", taken.length);
deed();
const late = new Node(1, 2);
console.log(tellOf(early), "|", tellOf(late), "|", taken.join());
(late as unknown as Str).text = "late";
console.log(tellOf(late), Object.prototype.hasOwnProperty.call(late, "kind"));
for (let i = 0; i < 200; i++) said = tellOf(new Node(1 + (i & 1), i));
console.log(said, taken.length);
delete (NodeMaker.prototype as { kind?: number }).kind;
console.log(tellOf(new Node(1, 3)), "|", tellOf(late), "|", taken.length);
