// Whatever is live across an allocation survives it, on the fast path and on the slow path where the garbage collector runs.
declare const console: any;
const log: any[] = [];
interface P { a: number; b: number }
interface Q { a: number; o1?: number; o2?: string; o3?: P; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number }
type Shape = { kind: 0; r: number } | { kind: 1; w: number; h: number } | { kind: 2; p: P };
function manyLive(n: number): number {
    let a = 1, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7, h = 8, i2 = 9, j = 10, k = 11, l = 12; let x = 0.5, y = 1.5, z = 2.5, w = 3.5, u = 4.5, v = 5.5, t = 6.5, s = 7.5; let sum = 0;
    for (let i = 0; i < n; i++) {
        const p: P = { a: a + i, b: b }; const arr = [c, d]; const fn = () => e + i; const empty: number[] = [];
        sum += p.a + p.b + arr[0] + arr[1] + fn() + empty.length + a + b + c + d + e + f + g + h + i2 + j + k + l + x + y + z + w + u + v + t + s;
        a += 1; b += 2; c += 3; d ^= i; e += 1; f += b & 3; g += 1; h -= 1; i2 += 2; j += 1; k -= 2; l += 3; x += 0.25; y *= 1.0000001; z -= 0.5; w += x * 0.001; u += 1.5; v -= 0.125; t += y * 0.001; s += 0.75;
    }
    return sum;
}
function lengths(a: any, b: any, c: any): string { const all = [[], [a], [a, b], [a, b, c], [a, b, c, a], [a, b, c, a, b], [a, b, c, a, b, c], [a, b, c, a, b, c, a]]; return all.map(x => x.length + ":" + JSON.stringify(x)).join(" "); }
function grows(a: number): string { const out: any[] = []; for (const arr of [[] as number[], [a], [a, a], [a, a, a], [a, a, a, a]]) { for (let i = 0; i < 9; i++) arr.push(i); arr[20] = 1; out.push(arr.length + "," + (15 in arr) + "," + arr.indexOf(8)); } return out.join(" "); }
function distinct(): boolean { const a: number[] = [], b: number[] = []; a.push(1); const c = [1], d = [1]; return a !== b && b.length === 0 && c !== d; }
function absent(i: number): string { const q: Q = { a: i }; const before = Object.keys(q).join(); if (i & 1) q.o3 = { a: 1, b: 2 }; if (i & 2) q.o8 = 8; return before + "|" + Object.keys(q).join() + "|" + JSON.stringify(q); }
function shape(i: number): Shape { return i % 3 === 0 ? { kind: 0, r: i } : i % 3 === 1 ? { kind: 1, w: i, h: 2 } : { kind: 2, p: { a: i, b: 1 } }; }
function area(s: Shape): number { return s.kind === 0 ? s.r * 3 : s.kind === 1 ? s.w * s.h : s.p.a + s.p.b; }
function leafObject(a: number, b: number): P { return { a, b }; }
function leafArray(a: number): number[] { return [a]; }
function leafClosure(a: number): () => number { return () => a; }
function counters(n: number): number { const all: (() => number)[] = []; for (let i = 0; i < n; i++) { let c = i; all.push(() => ++c); } let s = 0; for (const f of all) s += f() + f(); return s; }
function handled(n: number): string { let made = 0; try { for (let i = 0; i < n; i++) { const p = leafObject(i, 1); const a = [p, p]; made += a.length; if (i === n - 1) throw new RangeError("end " + a[1].a); } } catch (e: any) { return e.message + " " + made; } return "none"; }
function kept(n: number): number { const all: any[] = []; for (let i = 0; i < n; i++) all.push(i % 4 === 0 ? { a: i, b: i } : i % 4 === 1 ? [i, i] : i % 4 === 2 ? leafClosure(i) : []); let s = 0; for (const x of all) s += typeof x === "function" ? x() : Array.isArray(x) ? x.length : x.a; return s; }
function dropped(n: number): number { let s = 0; for (let i = 0; i < n; i++) { s += leafObject(i, 2).b + leafArray(i)[0] + leafClosure(i)() + [i, i, i].length + [i, i, i, i][3]; } return s; }
log.push("manyLive " + manyLive(300000)); log.push("lengths " + lengths(1, "two", { three: 3 })); log.push("grows " + grows(7)); log.push("distinct " + distinct());
for (let i = 0; i < 4; i++) log.push("absent " + absent(i));
let total = 0; for (let i = 0; i < 300000; i++) total += area(shape(i)); log.push("shapes " + total);
log.push("counters " + counters(100000)); log.push("handled " + handled(50000)); log.push("kept " + kept(400000)); log.push("dropped " + dropped(500000));
console.log(log.join("\n"));
export {};
