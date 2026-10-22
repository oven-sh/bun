// An array is born with its first storage. Everything an array can do to its storage is done, over collections.
import { edenGC, fullGC } from "bun:jsc";
interface Item { v: number; s: string }
const out: string[] = [];
const ring: unknown[] = new Array(2048).fill(null);
let turn = 0;
function churn(n: number): number {
  let x = 0;
  for (let i = 0; i < n; i++) {
    const a = [i, i + 1]; const b = ["s" + i, { v: i, s: "c" }, i]; const c: number[] = []; c.push(i); const d = b.slice(1); const e = a.concat(c);
    ring[turn++ & 2047] = a; ring[turn++ & 2047] = b; ring[turn++ & 2047] = c; ring[turn++ & 2047] = d; ring[turn++ & 2047] = e;
    x += a.length + b.length + c.length + d.length + e.length;
  }
  return x;
}
function collect(round: number) { churn(3000); if (round & 1) edenGC(); else fullGC(); }

// Grows out of the first storage, with young elements in an old array.
const grown: Item[][] = [];
for (let i = 0; i < 400; i++) grown.push([{ v: i, s: "first" }]);
fullGC();
for (let round = 0; round < 14; round++) { for (let i = 0; i < grown.length; i++) grown[i].push({ v: round * 1000 + i, s: "r" + round }); collect(round); }
let bad = "";
for (let i = 0; i < grown.length && !bad; i++) {
  const g = grown[i];
  if (g.length !== 15 || g[0].v !== i || g[0].s !== "first") bad = "head of " + i;
  for (let r = 0; r < 14 && !bad; r++) if (g[r + 1].v !== r * 1000 + i || g[r + 1].s !== "r" + r) bad = "element " + r + " of " + i;
}
out.push("grown: " + bad);

// Every length from 0 to 140 by literal-like births: new Array(n), slice, concat, map, filter, Array.from, spread.
bad = "";
const source: number[] = []; for (let i = 0; i < 140; i++) source.push(i * 3);
const keptAll: number[][] = [];
for (let n = 0; n <= 140; n++) {
  const a = source.slice(0, n), b = a.concat([n]), c = a.map(x => x + 1), d = a.filter(x => x % 2 === 0), e = Array.from(a), f = [...a, n], g = new Array<number>(n); for (let i = 0; i < n; i++) g[i] = i;
  keptAll.push(a, b, c, d, e, f, g);
  if ((n & 15) === 0) collect(n >> 4);
}
fullGC(); churn(5000); fullGC();
for (let n = 0; n <= 140 && !bad; n++) {
  const [a, b, c, d, e, f, g] = keptAll.slice(n * 7, n * 7 + 7);
  if (a.length !== n || b.length !== n + 1 || c.length !== n || d.length !== ((n + 1) >> 1) || e.length !== n || f.length !== n + 1 || g.length !== n) bad = "lengths at " + n + ": " + [a, b, c, d, e, f, g].map(x => x.length).join();
  for (let i = 0; i < n && !bad; i++) if (a[i] !== i * 3 || b[i] !== i * 3 || c[i] !== i * 3 + 1 || e[i] !== i * 3 || f[i] !== i * 3 || g[i] !== i) bad = "element " + i + " at " + n;
  if (!bad && (b[n] !== n || f[n] !== n)) bad = "last at " + n;
}
out.push("every length: " + bad);
// Each of them grows by one and by many afterwards.
bad = "";
for (let k = 0; k < keptAll.length; k++) { const a = keptAll[k], n = a.length; a.push(-1); if (a.length !== n + 1 || a[n] !== -1) bad = "push at " + k; }
collect(0);
for (let k = 0; k < keptAll.length; k++) { const a = keptAll[k], n = a.length; for (let i = 0; i < 40; i++) a.push(i); if (a.length !== n + 40 || a[n - 1] !== -1 || a[n + 39] !== 39) bad = "pushes at " + k; }
collect(1);
for (let k = 0; k < keptAll.length && !bad; k++) { const a = keptAll[k]; if (a[a.length - 41] !== -1 || a[a.length - 1] !== 39) bad = "after the collection at " + k; }
out.push("every length grows: " + bad);

// What arrays do.
const p = [10, 11, 12]; const alias = p;
p.push(13, 14, 15, 16, 17, 18); out.push("push: " + alias.join() + " " + alias.length);
alias.length = 2; out.push("shrunk: " + p.join() + " " + p.length);
alias.length = 0; out.push("emptied: " + p.join() + "|" + p.length); alias.push(1); out.push("filled again: " + p.join());
const big = [1, 2, 3]; big.length = 100000; out.push("long: " + big.length + " " + big[2] + " " + big[99999] + " " + (50 in big)); big.length = 1; big.push(7); out.push("short again: " + big.join());
let threwRange = false; try { [1, 2].length = -1; } catch (e) { threwRange = e instanceof RangeError; } out.push("bad length: " + threwRange);
const q = [20, 21, 22];
q[1] = 0.5; out.push("fraction: " + q.join());
(q as unknown as (number | string)[])[2] = "text"; out.push("text: " + q.join());
q[9] = 9; out.push("hole: " + q.join() + " " + q.length + " " + (5 in q));
q[100000] = 1; out.push("sparse: " + q.length + " " + q[9] + " " + q[100000] + " " + Object.keys(q).length);
const holes = [1, , 3, , 5]; holes.push(6); out.push("literal holes: " + holes.join() + " " + (1 in holes) + " " + holes.length);
const r = [30, 31, 32];
(r as unknown as { extra: string }).extra = "named"; (r as unknown as { more: number }).more = 2; out.push("named: " + (r as unknown as { extra: string }).extra + " " + Object.keys(r).join());
for (let i = 0; i < 12; i++) (r as unknown as Record<string, number>)["k" + i] = i; r.push(33, 34, 35, 36, 37); collect(0); out.push("many names: " + Object.keys(r).length + " " + r.join() + " " + (r as unknown as Record<string, number>).k11);
r.unshift(-1, -2); r.splice(1, 2, 7, 8, 9); r.reverse(); r.sort((a, b) => a - b); out.push("moved: " + r.join());
const s = [40, 41, 42];
Object.freeze(s); let threw = false; try { s.push(1); } catch { threw = true; } out.push("frozen: " + threw + " " + s.join() + " " + Object.isFrozen(s));
const sealed = [1, 2]; Object.seal(sealed); sealed[0] = 9; threw = false; try { sealed.push(3); } catch { threw = true; } out.push("sealed: " + threw + " " + sealed.join());
const closed = [1, 2]; Object.preventExtensions(closed); threw = false; try { closed.push(3); } catch { threw = true; } closed.pop(); out.push("not extensible: " + threw + " " + closed.join());
const defined = [1, 2, 3]; Object.defineProperty(defined, 1, { get() { return "got"; }, configurable: true }); out.push("accessor: " + defined.join() + " " + defined.length); defined.push(4); out.push("accessor, pushed: " + defined.join());
const readOnly = [1, 2, 3]; Object.defineProperty(readOnly, "length", { writable: false }); threw = false; try { readOnly.push(4); } catch { threw = true; } out.push("length is read-only: " + threw + " " + readOnly.join());
const removed = [1, 2, 3]; delete removed[1]; out.push("deleted: " + removed.join() + " " + (1 in removed)); removed.push(4); out.push("deleted, pushed: " + removed.join());
const t = [50, 51, 52];
out.push("copies: " + JSON.stringify(t) + " " + [...t].join() + " " + structuredClone(t).join() + " " + Array.isArray(t) + " " + Array.from(t.entries()).join("|") + " " + t.toString() + " " + t.with(1, 0).join() + " " + t.toReversed().join() + " " + t.toSorted().join() + " " + t.toSpliced(0, 1).join());
const proto = [1, 2, 3]; Object.setPrototypeOf(proto, { join() { return "mine"; } }); out.push("prototype: " + proto.join() + " " + Array.isArray(proto) + " " + proto.length + " " + Array.prototype.join.call(proto));
Array.prototype.push.call(proto, 4, 5, 6, 7, 8); out.push("prototype, pushed: " + Array.prototype.join.call(proto));
const w = new WeakRef([70, 71, 72]); const wm = new WeakMap<object, number>(); const kept = [71]; wm.set(kept, 5); fullGC(); out.push("weak: " + wm.get(kept) + " " + (w.deref() === undefined || w.deref()!.length === 3));
const filled = new Array<number>(5).fill(7); filled.push(8); out.push("filled: " + filled.join());
const copied = [1, 2, 3, 4, 5]; copied.copyWithin(0, 3); out.push("copyWithin: " + copied.join());
const flat = [[1, 2], [3, [4, 5]], 6].flat(2); flat.push(7); out.push("flat: " + flat.join());
console.log(out.join("\n"));
