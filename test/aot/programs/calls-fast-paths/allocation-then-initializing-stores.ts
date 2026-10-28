// No other code is left between an object's allocation and its initializing stores.
// IR= 0 identifier Upcast
declare const console: any;
interface Mapper { kind: number; sources: number[]; targets: number[] }
function makeMapper(sources: number[], targets: number[]): Mapper { return { kind: 1, sources, targets }; }
interface Diagnostic { code: number; text: string; args: number[] }
function makeDiagnostic(code: number, text: string, ...args: number[]): Diagnostic { return { code, text, args }; }
interface Node { kind: number; pos: number; end: number; flags: number }
interface Identifier extends Node { text: string | undefined }
function Node(this: Node, kind: number, pos: number, end: number) { this.kind = kind; this.pos = pos; this.end = end; this.flags = 0; }
const IdentifierConstructor = Node as any as new (kind: number, pos: number, end: number) => Identifier;
function withLiteral(a: number, b: number, t: number[]): Mapper { return makeMapper([a, b], t); }
function withRest(a: number, b: number): Diagnostic { return makeDiagnostic(a, "d", a, b, a + b); }
function identifier(text: string): Identifier { const n = new IdentifierConstructor(80, -1, -1); n.text = text; return n; }
const t = [1, 2];
let s = 0;
for (let i = 0; i < 1_000_000; i++) { const m = withLiteral(i, i + 1, t); const d = withRest(i, 2); const n = identifier("x"); s += m.sources[1] + m.targets[0] + d.args[2] + d.code + n.kind + n.pos + n.flags; }
console.log(s, Object.keys(withLiteral(1, 2, t)).join(), Object.keys(withRest(1, 2)).join(), Object.keys(identifier("y")).join());
export {};
