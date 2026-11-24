// Two constructor functions make the objects of a tagged union. `original` is left undefined by one of them and is no field of the other, `emitted` is left undefined by both: one read of it finds it in the same granule of every member.
interface Emitted { flags: number; text: string }
interface Base { kind: number; pos: number; original?: Base; emitted?: Emitted }
interface Call extends Base { kind: 1; callee: Base; count: number }
interface Name extends Base { kind: 2; text: string }
interface Plus extends Base { kind: 3 }
interface Word extends Base { kind: 4; text: string }
function NodeMaker(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; this.original = undefined; this.emitted = undefined; }
function TokenMaker(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; this.emitted = undefined; }
const NodeObject = NodeMaker as unknown as new (kind: number, pos: number) => Base;
const TokenObject = TokenMaker as unknown as new (kind: number, pos: number) => Base;
function call(callee: Base, pos: number): Call { const made = new NodeObject(1, pos) as Call; made.callee = callee; made.count = 0; return made; }
function named(text: string, pos: number): Name { const made = new NodeObject(2, pos) as Name; made.text = text; return made; }
function plus(pos: number): Plus { return new TokenObject(3, pos) as Plus; }
function word(text: string, pos: number): Word { const made = new TokenObject(4, pos) as Word; made.text = text; return made; }
function flagsOf(node: Base): number { const emitted = node.emitted; return emitted ? emitted.flags : 0; }
function mark(node: Base, flags: number): void { (node.emitted ??= { flags: 0, text: "t" }).flags |= flags; }
const nodes: Base[] = [];
for (let i = 0; i < 200; i++) { const n = named("a" + i, i); nodes.push(n, call(n, i), plus(i), word("w" + i, i)); }
for (let i = 0; i < nodes.length; i += 37) mark(nodes[i], i);
nodes[1].original = nodes[0]; nodes[3].original = nodes[2];
let sum = 0;
for (const n of nodes) sum = (sum * 3 + flagsOf(n)) % 1000003;
console.log(sum, nodes.filter(n => n.emitted).length, [0, 1, 2, 3, 37, 74, 111].map(i => Object.keys(nodes[i]).join()).join(" "), nodes[1].original === nodes[0], nodes[3].original === nodes[2]);
