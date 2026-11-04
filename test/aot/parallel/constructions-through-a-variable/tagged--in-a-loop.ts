interface Base { kind: number; pos: number }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
function NodeMaker(this: Base, kind: number, pos: number) { this.kind = kind; this.pos = pos; }
const Node = NodeMaker as unknown as new (kind: number, pos: number) => Base;
var Held: new (kind: number, pos: number) => Base;
function start() { Held = Node; }
function make(kind: number): Base { return new Held(kind, 3); }
const attempt = (f: () => unknown) => { try { return f(); } catch (e) { return "threw " + (e as Error).name; } };
const unknownTag = (n: number): number => process.argv.length < 99 ? n : 0;
start(); let t = 0; for (let i = 0; i < 300; i++) t += make(unknownTag(i % 4)).kind; console.log(t);
