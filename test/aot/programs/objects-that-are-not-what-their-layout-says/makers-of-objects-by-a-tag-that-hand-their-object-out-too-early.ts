// One constructor function makes the nodes of every kind, and the interface that writes the kind says which further names a node gets. Nothing here leaves for code that the compiler does not see,
// so whatever a maker fills before its object leaves its hands counts as filled for good. Each maker below lets somebody look earlier than that, or is entered in another way than by `new`.
const out: string[] = [];
const enum Kind { Name = 1, Sum = 2, Other = 3 }
interface Node { kind: Kind; pos: number; end: number }
interface Name extends Node { kind: Kind.Name; text: string }
interface Sum extends Node { kind: Kind.Sum; left: Node }
function look(node: Node): string { return String(node.kind) + " " + String(node.pos) + " " + String(node.end) + " [" + Object.keys(node).join() + "]"; }
type Maker = new (kind: Kind, pos: number, end: number) => Node;

function WholeObject(this: Node, kind: Kind, pos: number, end: number) { this.kind = kind; this.pos = pos; this.end = end; }
const Whole = WholeObject as unknown as Maker;
for (const kind of [Kind.Name, Kind.Sum, Kind.Other]) out.push("whole: " + look(new Whole(kind, 1, 2)));

function LooksObject(this: Node, kind: Kind, pos: number, end: number) { this.kind = kind; out.push("a helper looks: " + look(this)); this.pos = pos; this.end = end; }
const Looks = LooksObject as unknown as Maker;
for (const kind of [Kind.Name, Kind.Sum, Kind.Other]) out.push("then: " + look(new Looks(kind, 3, 4)));

let kept: Node[] = [];
function KeepsObject(this: Node, kind: Kind, pos: number, end: number) { this.kind = kind; kept.push(this); if (kept.length > 1) out.push("the one before, and this one: " + kept.map(look).join(" | ")); this.pos = pos; this.end = end; }
const Keeps = KeepsObject as unknown as Maker;
for (const kind of [Kind.Name, Kind.Sum, Kind.Other]) new Keeps(kind, 5, 6);
out.push("kept: " + kept.map(look).join(" | "));

function LeavesObject(this: Node, kind: Kind, pos: number, end: number) { this.kind = kind; if (pos < 0) return; this.pos = pos; if (end < 0) throw new RangeError("end"); this.end = end; }
const Leaves = LeavesObject as unknown as Maker;
out.push("returns early: " + look(new Leaves(Kind.Name, -1, 0)) + " | " + look(new Leaves(Kind.Sum, 7, 8)));
let thrown: Node | undefined;
function ThrowsObject(this: Node, kind: Kind, pos: number, end: number) { this.kind = kind; thrown = this; this.pos = pos; if (end < 0) throw new RangeError("end"); this.end = end; }
const Throws = ThrowsObject as unknown as Maker;
try { new Throws(Kind.Sum, 9, -1); } catch (error) { out.push("throws: " + (error as Error).name + " " + look(thrown!)); }

const bare: Node = Object.create(null);
(WholeObject as unknown as (this: Node, kind: Kind, pos: number, end: number) => void).call(bare, Kind.Name, 10, 11);
out.push("called on another object: " + look(bare) + " " + String(Object.getPrototypeOf(bare)));
class Below { }
const under = Reflect.construct(WholeObject, [Kind.Sum, 12, 13], Below) as Node;
out.push("constructed for another class: " + look(under) + " " + String(under instanceof Below) + " " + String(under instanceof (WholeObject as unknown as Function)));

function ReturnsObject(this: Node, kind: Kind, pos: number, end: number) { this.kind = kind; this.pos = pos; this.end = end; if (kind === Kind.Other) return { kind, pos: -pos, end: -end }; }
const Returns = ReturnsObject as unknown as Maker;
for (const kind of [Kind.Name, Kind.Other]) out.push("returns another object: " + look(new Returns(kind, 14, 15)));

const name = new Whole(Kind.Name, 16, 17) as Name;
name.text = "n";
const sum = new Whole(Kind.Sum, 18, 19) as Sum;
sum.left = name;
out.push("later names: " + look(name) + " " + name.text + " | " + look(sum) + " " + look(sum.left));
delete (name as Partial<Node>).pos;
out.push("a name is deleted: " + look(name));

console.log(out.join("\n"));
