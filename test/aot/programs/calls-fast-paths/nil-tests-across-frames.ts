// One argument is passed to several small inlined functions with different parameter types: only the first one tests it for null or undefined.
declare const console: any;
interface Node { kind: number; flags: number; id: number; pos: number; end: number; parent: Node | undefined }
interface HasKind { kind: number } interface HasFlags { flags: number } interface HasId { id: number } interface HasPos { pos: number } interface HasEnd { end: number }
function kindOf(x: HasKind) { return x.kind; } function flagsOf(x: HasFlags) { return x.flags; } function idOf(x: HasId) { return x.id; } function posOf(x: HasPos) { return x.pos; } function endOf(x: HasEnd) { return x.end; }
function all(n: Node): number { return kindOf(n) + flagsOf(n) * 2 + idOf(n) * 3 + posOf(n) * 5 + endOf(n) * 7; }
const nodes: Node[] = [];
for (let i = 0; i < 64; i++) nodes.push({ kind: i, flags: i * 2, id: i * 3, pos: i * 4, end: i * 5, parent: undefined });
let s = 0;
for (let round = 0; round < 100000; round++) { for (let i = 0; i < 64; i++) s += all(nodes[i]); }
console.log(s);
export {};
