// A constructor whose initial stores cannot throw is inlined inside `try` blocks too.
// IR= 0 inTry CallDirect \(v[0-9]+, v[0-9]+, v[0-9]+\) function=f[0-9]+
// IR= 0 inAsync CallDirect \(v[0-9]+, v[0-9]+, v[0-9]+\) function=f[0-9]+
declare const console: any;
interface Pt { x: number; y: number }
function Pt(this: Pt, x: number, y: number) { this.x = x; this.y = y; }
const PtConstructor = Pt as any as new (x: number, y: number) => Pt;
function inTry(a: number): number { try { const p = new PtConstructor(a, 1); return p.x + p.y; } catch { return -1; } }
async function inAsync(a: number): Promise<number> { const p = new PtConstructor(a, 2); await undefined; return p.x + p.y; }
let s = 0;
for (let i = 0; i < 3_000_000; i++) s += inTry(i & 7);
inAsync(5).then(r => console.log(s, r, [inTry].map(kept => kept(3)).join()));
export {};
