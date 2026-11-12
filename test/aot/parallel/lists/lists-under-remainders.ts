// Lists stored into and read under remainders that go round a loop, in a variable and in a field: of every kind, of length zero, cut and grown on the way, with starts and steps that are no index.
const show = (x: any): string => Object.is(x, -0) ? "-0" : Array.isArray(x) ? "[" + Array.from(x, show).join() + "]" + Object.keys(x).filter(k => !/^\d+$/.test(k)).join() : String(x);
class Ring { items: number[]; at = 0; constructor(items: number[]) { this.items = items; } add(x: number) { this.items[this.at] = x; this.at = (this.at + 1) % this.items.length; } back(x: number) { this.items[this.at] = x; this.at = (this.at - 1) % this.items.length; } }
const ring = new Ring([0, 0, 0]);
function around(L: number[], at: any, k: number): any { for (let i = 0; i < 12; i++) { L[at] = i * k; at = (at + 1) % L.length; } return [at, L]; }
function from(L: number[], s: any, k: number): any { let at = 0, t = 0; for (let i = 0; i < 12; i++) { t += L[at]!; at = (at + 1) % L.length; } return [at, t]; }
function back(L: number[], s: any, k: number): any { let at = 0; for (let i = 0; i < 12; i++) { L[at] = i * k; at = (at - 1) % L.length; } return [at, L]; }
function wrapped(L: number[], s: any, k: number): any { let at = 1; for (let i = 0; i < 12; i++) { L[at] = i * k; at = (at - 1 + L.length) % L.length; } return [at, L]; }
function cut(L: number[], s: any, k: number): any { let at = 0; for (let i = 0; i < 12; i++) { L[at] = i * k; at = (at + 1) % L.length; if (i === 5) L.length = 0; } return [at, L]; }
function grown(L: number[], s: any, k: number): any { let at = 0; for (let i = 0; i < 12; i++) { L[at] = i * k; at = (at + 1) % L.length; if (i % 4 === 3) L.push(i); } return [at, L]; }
function late(L: number[], s: any, k: number): any { let at = 0; for (let i = 0; i < 12; i++) { L[at] = (i > 8 ? "x" : i * k) as any; at = (at + 1) % L.length; } return [at, L]; }
function counted(L: number[], n: any, k: number): any { let at = 0; for (let i = 0; i < 12; i++) { L[at] = i * k; at = (at + 1) % n; } return [at, L]; }
function kept(L: number[], s: any, k: number): any { ring.items = L; ring.at = s; for (let i = 0; i < 12; i++) ring.add(i * k); return [ring.at, ring.items]; }
function keptBack(L: number[], s: any, k: number): any { ring.items = L; ring.at = s; for (let i = 0; i < 12; i++) ring.back(i * k); return [ring.at, ring.items]; }
function own(L: number[], s: any, k: number): any { const q = new Ring(L); q.at = s; for (let i = 0; i < 12; i++) { q.add(i * k); if (i === 7) q.items = [9, 9]; } return [q.at, q.items, L]; }
function field(L: number[], s: any, k: number): any { const q = { l: L, at: s }; for (let i = 0; i < 12; i++) { q.l[q.at] = i * k; q.at = (q.at + 1) % q.l.length; } return [q.at, L]; }
const lists: (() => any)[] = [() => [0, 0, 0, 0, 0], () => [1.5, 2.5, 3.5], () => new Array(7).fill(0), () => new Array(3), () => [], () => ["a", "b"], () => [1, , 3], () => Object.freeze([1, 2, 3]), () => JSON.parse("[1,2,3,4]"), () => JSON.parse("[0.5,1,2]"), () => Float64Array.from([1, 2, 3]), () => new Uint8Array(5), () => new (class extends Array {})(4).fill(1), () => Object.defineProperty([1, 2, 3], 1, { set(v) { this[2] = v; }, get() { return 7; } })];
const starts: any[] = [0, 2, 1.5, -1, NaN, "1", undefined, 7];
for (const run of [around, from, back, wrapped, cut, grown, late, counted, kept, keptBack, own, field])
  for (const list of lists)
    for (const start of starts)
      for (const k of [1, 1.5, NaN]) {
        let said: string;
        try { said = show(run(list(), start, k)); } catch (e) { said = "!" + (e as any).constructor.name; }
        console.log(run.name, said.slice(0, 90));
      }
