// A join that takes a parameter whose type is declared, or what one of its fields names: `pos` of either is read by the layouts of the parameter.
interface Range1 { pos: number; end: number }
interface Emitted { flags: number; range?: Range1 }
class Node1 { kind: number; pos: number; end: number; emitted: Emitted | undefined; constructor(kind: number, pos: number, end: number) { this.kind = kind; this.pos = pos; this.end = end; this.emitted = undefined; } }
class Name1 extends Node1 { text: string; constructor(text: string, pos: number) { super(1, pos, pos + text.length); this.text = text; } }
class List1 extends Node1 { items: Node1[]; constructor(items: Node1[], pos: number) { super(2, pos, pos + 9); this.items = items; } }
function rangeOf(node: Node1): Range1 { return node.emitted?.range ?? node; }
function widthOf(node: Node1): number { const range = rangeOf(node); return range.end - range.pos; }
(globalThis as any).widthOf = widthOf; (globalThis as any).rangeOf = rangeOf;
const nodes: Node1[] = [];
for (let i = 0; i < 300; i++) { const n = new Name1("n" + i, i); nodes.push(n, new List1([n], i)); }
for (let i = 0; i < nodes.length; i += 7) nodes[i].emitted = { flags: i, range: i % 3 ? { pos: i, end: i + 2 } : undefined };
const others: any[] = [{ pos: 1, end: 5 }, { end: 7, pos: 1, emitted: undefined }, { get pos() { return 2; }, end: 4 }, Object.assign([1, 2], { pos: 3, end: 5 }), new Proxy({ pos: 1, end: 2 }, {}), Object.freeze(new Node1(3, 4, 8))];
let sum = 0;
for (const n of nodes) sum += (globalThis as any).widthOf(n);
for (const o of others) sum = sum * 3 + (globalThis as any).widthOf(o);
try { (globalThis as any).widthOf(undefined); } catch (e: any) { sum = sum * 3 + e.name.length; }
console.log(sum);
