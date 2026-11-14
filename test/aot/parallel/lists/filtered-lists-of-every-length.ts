// filter of lists of zero to forty elements of each kind, keeping none, few, half and all; what stands behind the length of the result, results that are kept, pushed to and grown, sources that change under the callback.
declare const Bun: any;
const out: string[] = [];
const kept: any[][] = [];
const show = (name: string, f: () => unknown) => { let r: unknown; try { r = f(); } catch (e: any) { r = e.constructor.name + ": " + e.message; } out.push(name + " " + String(r)); };
function look(t: any[]): string { const n = t.length; let s = n + (n in t ? "!" : "") + String(t[n]) + String(t.at(-1)) + Object.keys(t).length; t.push("p", 1.5, undefined); s += t.length + String(t[n + 1]); t.length = n; t[n + 2] = 7; s += (n in t ? "!" : "") + t.length + Object.keys(t).length; return s; }
function hash(s: string): number { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000003; return h; }
function every(make: (k: number) => any): string {
  let s = "";
  for (let n = 0; n <= 40; n++) {
    const t: any[] = [];
    for (let k = 0; k < n; k++) t.push(make(k));
    for (let m = 1; m < 12; m += 2) { const r = t.filter((x, k) => k % m === 0); s += look(r); if ((n + m) % 9 === 0) kept.push(r); }
    s += look(t.filter(() => true)) + look(t.filter(() => false)) + look(t.filter((x, k) => k > n - 4)) + t.filter((x, k, list) => list === t && k & 1).length;
  }
  return hash(s) + ":" + s.length;
}
function numbers(n: number): string { let s = 0; const t = Array.from({ length: n }, (_, k) => k), d = t.map(k => k / 2); for (let i = 0; i < 300; i++) { const r = t.filter(x => x % ((i & 7) + 1) === 0), q = d.filter(x => x * 2 % ((i & 3) + 1) === 0); s += r.length * 3 + q.length + (r[r.length - 1] ?? 0) + (q[q.length - 1] ?? 0); if (i % 50 === 0) kept.push(r, q); } return String(s); }
show("ints", () => every(k => k)); show("doubles", () => every(k => k + 0.5)); show("strings", () => every(k => "s" + k)); show("objects", () => every(k => ({ toString() { return "o" + k; } }))); show("mixed", () => every(k => [k, k / 3, "m" + k, null, undefined, -0, NaN, true][k & 7]));
for (const n of [0, 1, 4, 5, 6, 8, 9, 10, 16, 33, 200]) show("numbers" + n, () => numbers(n));
show("holes", () => { const t = [1, , 3, , , 6, 7, , 9, 10, 11, , 13]; return look(t.filter(() => true)) + look(t.filter(x => x! > 5)); });
show("grown under the callback", () => { const t = [1, 2, 3]; return t.filter(x => { if (t.length < 30) t.push(x); return true; }).join() + t.length; });
show("cut under the callback", () => { const t = Array.from({ length: 20 }, (_, k) => k); return t.filter(x => { t.length = 8; return x & 1; }).join(); });
show("changed kinds", () => { const t: any[] = Array.from({ length: 14 }, (_, k) => k); return t.filter((x, k) => { if (k === 3) t[9] = "nine"; if (k === 5) t[10] = 10.5; return k !== 4; }).map(x => typeof x + x).join(); });
class Sub extends Array<number> { total() { let s = 0; for (const x of this) s += x; return s; } }
show("subclass", () => { const t = new Sub(); for (let k = 0; k < 12; k++) t.push(k); const r = t.filter(x => x > 2) as Sub; return r.constructor.name + r.total() + look(r); });
show("frozen", () => look(Object.freeze(Array.from({ length: 11 }, (_, k) => k)).filter(x => x < 10) as any[]));
show("throws", () => [1, 2, 3, 4, 5, 6, 7].filter(x => { if (x === 6) throw new RangeError("six"); return true; }));
if (typeof Bun === "object") Bun.gc(true);
show("kept", () => { let s = ""; for (const t of kept) s += t.length + ":" + t.map(x => String(x)).join(); return kept.length + " " + hash(s); });
for (const line of out) console.log(line);
