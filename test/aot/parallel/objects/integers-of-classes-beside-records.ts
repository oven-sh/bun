// Classes and records of one union hold a field in one form: integers, where the program reads integers of the classes. Other numbers come too.
class Node { kind: number; pos: number; end: number; parent: Node | undefined; constructor(kind: number, pos: number, end: number, parent: Node | undefined) { this.kind = kind; this.pos = pos; this.end = end; this.parent = parent; } }
class Token extends Node { text = ""; }
interface Reference { fileName: string; pos: number; end: number }
interface Range { pos: number; end: number; hasTrailing?: boolean }
const text = process.argv.length > 90 ? "other" : "let a = b + c; // a comment";
const show = (v: unknown): string => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : typeof v === "object" && v !== null ? JSON.stringify(v, (k, x) => k === "parent" ? "@" : Object.is(x, -0) ? "-0" : typeof x === "number" || typeof x === "bigint" ? String(x) : x) : String(v);
function shift(node: Node, by: number): void { node.pos = (node.pos + by) | 0; node.end = (node.end + by) | 0; }
function codeAt(node: Node): number { return (text.charCodeAt(node.pos) || 0) + (text.charCodeAt(node.end) || 0); }
function widthOf(item: Node | Reference): number { return item.end - item.pos; }
function rangeOf(item: Node | Reference | Range): string { return item.pos + ".." + item.end; }
function move(item: Node | Reference, pos: any, end: any): void { item.pos = pos; item.end = end; }
function reference(name: string, data: any): Reference { return { fileName: name, pos: data.pos, end: data.end }; }
const nodes: Node[] = [];
let parent: Node | undefined;
for (let i = 0; i < 20; i++) { parent = i % 4 === 3 ? new Token(i, i, i + 3, parent) : new Node(i, i, i + 3, parent); nodes.push(parent); }
const numbers: any[] = JSON.parse("[0, 1, -1, 0.5, 2147483647, 2147483648, -2147483648, -2147483649, 9007199254740992, 1e300, null]").concat([-0, NaN, Infinity, undefined, "7", 5n, true]);
const items: (Node | Reference)[] = [...nodes];
for (const n of numbers) items.push(reference("x.ts", { pos: n, end: 4 }));
const others: any = globalThis;
others.kept = { nodes, items };
others["run" + items.length]?.(nodes, items);
const attempt = (f: () => unknown): string => { try { return show(f()); } catch (e) { return (e as Error).constructor.name; } };
let sum = 0;
for (let k = 0; k < 3; k++) for (const node of nodes) { shift(node, k - 1); sum += codeAt(node); }
console.log(sum);
for (const item of items) console.log(attempt(() => widthOf(item)), attempt(() => rangeOf(item)), show(item));
for (const n of numbers) {
  const node = new Node(1, 2, 3, undefined), ref = reference("r", { pos: 1, end: 2 });
  move(node, n, n); move(ref, n, 1);
  console.log(show(n), attempt(() => widthOf(node)), attempt(() => widthOf(ref)), rangeOf(node), rangeOf(ref), show(node), show(ref));
  console.log(attempt(() => shift(node, 1)), attempt(() => move(node, 1, n)));
  console.log(show(node), Object.keys(ref).join(), "pos" in ref, delete (ref as any).pos, show(ref), attempt(() => rangeOf(ref)));
}
console.log(rangeOf({ pos: 1, end: 2 }), rangeOf({ pos: 0.5, end: -0 }));
