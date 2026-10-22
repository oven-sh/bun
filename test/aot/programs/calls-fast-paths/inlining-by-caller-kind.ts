// The inliner takes the kind of caller into account: plain functions inline small callees, and so do async functions, which stay one function across an `await`; module top-level code does not.
// IR= 0 plain CallDirect
// IR= 0 waits CallDirect \(v[0-9]+, v[0-9]+\) function=f[0-9]+
// IR= 2 waits  = Mul .*#[0-9]+$
// IRM= 1 CallDirect \(v[0-9]+, v[0-9]+\) function=f[0-9]+
// IRM= 3 CallDirect \(v[0-9]+\) function=f[0-9]+
declare const console: any;
function add(a: number, b: number): number { return a * 3 + b; }
interface Pt { x: number; y: number }
function Pt(this: Pt, x: number, y: number) { this.x = x; this.y = y; }
const PtConstructor = Pt as any as new (x: number, y: number) => Pt;
function plain(a: number): number { return add(a, 1) + add(a, 2); }
async function waits(a: number): Promise<number> { const x = add(a, 1); await undefined; return x + add(a, 2); }
async function waitsAndMakes(a: number): Promise<number> { await undefined; const p = new PtConstructor(a, 1); return p.x + p.y; }
let s = 0;
for (let i = 0; i < 1_000_000; i++) s += plain(i & 7);
const top = add(s & 3, 4) + plain(2);
Promise.all([waits(1), waitsAndMakes(2)]).then(r => console.log(s, top, r.join()));
export {};
