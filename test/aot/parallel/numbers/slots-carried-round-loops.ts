// A field that is an integer or nothing, read and stored by loops: directly, through another name, by a method, a getter, a setter, a handler, in nested loops.
class Box { x: number; y: number; n: number; constructor(x: number) { this.x = x; this.y = 1; this.n = 0; } put(v: number): void { this.x = v; this.n++; } get twice(): number { this.x = (this.x * 2) | 0; return this.x; } set half(v: number) { this.x = v >> 1; } clear(): void { this.x = undefined as any; } }
function mix(h: number, x: number | undefined): number { return x === undefined ? (h ^ 0x5bd1e995) | 0 : (Math.imul(h, 31) + x) | 0; }
let held: Box | undefined;
function pull(s: number): void { held!.x = (s >> 4) | 0; }
const table = new Int32Array([3, 5, 1, 0, 2, 9, -1, 4]);
function sum(o: Box, n: number): number { let s = 0; for (let i = 0; i < n; i++) { s = (s + o.x) | 0; o.x = s; } return s; }
function after(o: Box, n: number): number { let s = 1; for (let i = 0; i < n; i++) { o.x = (o.x + i) | 0; s = mix(s, o.x); } return s; }
function same(o: Box, q: Box, n: number): number { let s = 1; for (let i = 0; i < n; i++) { s = mix(s, o.x); q.x = (s + i) | 0; s = mix(s, o.x); } return s; }
function choice(o: Box, p: Box, n: number): number { let s = 1; for (let i = 0; i < n; i++) { const t = i & 1 ? o : p; s = mix(s, o.x); t.x = (s ^ i) | 0; s = mix(s, p.x); } return s; }
function turns(o: Box, p: Box, n: number): number { let s = 1, t = o; for (let i = 0; i < n; i++) { s = mix(s, t.x); t.x = (s + 7) | 0; t = t === o ? p : o; s = mix(s, o.x); } return s; }
function called(o: Box, n: number): number { let s = 1; for (let i = 0; i < n; i++) { s = mix(s, o.x); o.put((s >> 2) | 0); s = mix(s, o.x); s = mix(s, o.twice); o.half = s; s = mix(s, o.x); } return s; }
function cleared(o: Box, n: number): number { let s = 1; for (let i = 0; i < n; i++) { s = mix(s, o.x); if (i === 3) o.clear(); else o.x = table[s & 15]!; s = mix(s, o.x); } return s; }
function caught(o: Box, n: number): number { let s = 1; for (let i = 0; i < n; i++) { try { s = mix(s, o.x); o.x = (s + 1) | 0; if (i & 1) throw new Error("e"); s = mix(s, o.x); } catch { s = mix(s, o.x); o.x = (o.x ^ i) | 0; } finally { o.x = (o.x + 1) | 0; } s = mix(s, o.x); } return s; }
function nested(o: Box, n: number): number { let s = 1; for (let k = 0; k < 4; k++) { s = mix(s, o.x); for (let i = 0; i < n; i++) { s = mix(s, o.x); o.x = (s ^ k) | 0; } s = mix(s, o.x); } return s; }
function poked(o: Box, n: number): number { let s = 1; for (let i = 0; i < n; i++) { s = mix(s, o.x); held = o; pull(s); s = mix(s, o.x); } return s; }
function listed(o: Box, l: Box[], n: number): number { let s = 1; for (let i = 0; i < n; i++) { const t = l[i & 3]!; s = mix(s, t.x); t.x = (s + o.x) | 0; s = mix(s, o.x); } return s; }
function made(o: Box, n: number): number { let s = 1, t = o; for (let i = 0; i < n; i++) { s = mix(s, t.x); t.x = (s + i) | 0; if (i === 2) { const u = new Box(s & 31); u.x = t.x; t = u; } s = mix(s, t.x); } return s; }
for (const start of [0, 7, -5, 2147483647]) for (const n of [0, 1, 2, 5, 9, 33]) { const o = new Box(start), p = new Box(2), l = [o, p, new Box(start), p]; console.log(start, n, sum(o, n), after(o, n), same(o, o, n), same(o, p, n), choice(o, p, n), turns(o, p, n), called(o, n), cleared(o, n), caught(o, n), nested(o, n), poked(o, n), listed(o, l, n), made(o, n), o.x, p.x, o.n); }
export {};
