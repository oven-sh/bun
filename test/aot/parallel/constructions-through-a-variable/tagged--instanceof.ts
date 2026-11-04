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
start(); console.log(make(unknownTag(1)) instanceof Node, make(unknownTag(9)) instanceof Node, Object.getPrototypeOf(make(unknownTag(2))) === NodeMaker.prototype);
