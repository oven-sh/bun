interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
const kept = { kind: 77, other: "kept" };
function NodeMaker(this: Base, kind: number, pos: number): any { this.kind = kind; this.pos = pos; if (kind === 9) return kept; }
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
var Held: new (kind: number, pos: number) => Base;
function start() { Held = Node; }
function make(kind: number): Base { return new Held(kind, 3); }
const attempt = (f: () => unknown) => { try { return f(); } catch (e) { return "threw " + (e as Error).name; } };
const unknownTag = (n: number): number => process.argv.length < 99 ? n : 0;
start(); for (const k of [1, 9, 2]) console.log(Object.keys(make(unknownTag(k))).join());
