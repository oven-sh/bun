// Elements moved up beside one that was taken out (insertion sort and its like): lists of every kind, short, with holes, frozen, proxied, of texts; counters that run out of the list.
const show = (x: any): string => typeof x === "function" ? "f" : Object.is(x, -0) ? "-0" : Array.isArray(x) ? "[" + Array.from({ length: Math.min(x.length, 40) }, (_, i) => i in x ? x[i] : "hole").map(show).join() + "]" : typeof x === "string" ? JSON.stringify(x) : x !== null && typeof x === "object" ? "{" + Object.keys(x).slice(0, 30).map(k => k + ":" + show(x[k])).join() + "}" : String(x);
function insert(c: number[]): any { for (let i = 1; i < c.length; i++) { const x = c[i]!; let j = i - 1; while (j >= 0 && c[j]! > x) { c[j + 1] = c[j]!; j--; } c[j + 1] = x; } return c; }
function below(c: number[]): any { for (let i = 1; i < c.length; i++) { const x = c[i]!; let j = i; while (j > 0 && c[j - 1]! > x) { c[j] = c[j - 1]!; j--; } c[j] = x; } return c; }
function counted(c: number[]): any { for (let i = 1; i < c.length; i++) { const x = c[i]!; let j: number; for (j = i - 1; j >= 0 && c[j]! > x; j--) c[j + 1] = c[j]!; c[j + 1] = x; } return c; }
function left(c: number[]): any { for (let i = 1; i < c.length; i++) { const x = c[i]!; let j = i - 1; for (; j >= 0; j--) { const y = c[j]!; if (y <= x) break; c[j + 1] = y; } c[j + 1] = x; } return c; }
function added(c: number[]): any { for (let i = 1; i < c.length; i++) { const x = c[i]!; let j = i - 1; while (j >= 0 && c[j]! > x) { c[j + 1] = c[j]! + 1; j--; } c[j + 1] = x; } return c; }
function summed(c: number[]): any { let s = 0; for (let i = 1; i < c.length; i++) { s += c[i]!; let j = Math.min(c.length - 2, 9); while (j >= 0) { c[j + 1] = c[j]!; j--; } } return [s, c]; }
function past(c: number[]): any { for (let i = 1; i < c.length && i < 12; i++) { const x = c[i]!; let j = i + 2; while (j >= 0 && !(c[j]! < x)) { c[j + 1] = c[j]!; j--; } c[j + 1] = x; } return c.length; }
function upward(c: number[]): any { for (let i = 0; i < c.length && i < 12; i++) { const x = c[i]!; let j = i; while (j < 20 && c[j]! !== x + 1) { c[j] = c[j + 1]!; j++; } } return c; }
function halves(c: number[]): any { for (let i = 1; i < c.length; i++) { const x = c[i]!; let j = i - 0.5; while (j >= 0 && c[j]! > x) { c[j + 1] = c[j]!; j--; } c[j + 1] = x; } return Object.keys(c).length; }
function other(c: number[], d: number[]): any { for (let i = 1; i < c.length; i++) { const x = c[i]!; let j = i - 1; while (j >= 0 && c[j]! > x) { d[j + 1] = c[j]!; j--; } d[j + 1] = x; } return [c, d]; }
class Sorted { items: number[]; constructor(items: number[]) { this.items = items; } add(x: number) { const c = this.items; let j = c.length - 1; c.push(x); while (j >= 0 && c[j]! > x) { c[j + 1] = c[j]!; j--; } c[j + 1] = x; return this; } }
function kept(c: number[]): any { const s = new Sorted([]); for (let i = 0; i < c.length && i < 30; i++) s.add(c[i]!); return s.items; }
const spied = (l: any): any => new Proxy(l, { get(t, k) { return k === "2" ? 1.25 : Reflect.get(t, k); }, set(t, k, v) { return k === "3" ? Reflect.set(t, k, v * 2) : Reflect.set(t, k, v); } });
const setter = (): any => { const l: any = [5, 4, 3, 2, 1]; Object.defineProperty(l, 2, { get() { return 2.5; }, set(v) { l.seen = (l.seen ?? 0) + 1; }, configurable: true }); return l; };
const lists: (() => any)[] = [() => [5, 3, 4, 1, 2], () => [2.5, 0.5, 1.5, -1], () => [3, 1.5, 2, 1], () => [], () => [1], () => [3, , 1, 2], () => [2.5, , 0.5], () => ["c", "a", "b"], () => [3, "2", 1, null, undefined], () => [NaN, 2, -0, 0, 1], () => Object.freeze([3, 2, 1]), () => Object.seal([3, 2, 1]), () => JSON.parse("[4,3,2,1,0,9]"), () => JSON.parse("[4.5,3,2.5,1]"), () => Array.from({ length: 30 }, (_, i) => (i * 7919) % 31), () => new Float64Array([3, 1, 2]), () => new Int8Array([100, -100, 0]), () => (class extends Array {}).from([3, 2, 1]), () => spied([4, 3, 2, 1]), () => setter(), () => ({ length: 3, 0: 3, 1: 2, 2: 1 }), () => [{ valueOf() { return 2; } }, 1, 0], () => [4294967295, -2147483648, 2147483647, 0], () => "cab"];
for (let turn = 0; turn < 3; turn++)
  for (let l = 0; l < lists.length; l++)
    for (const run of [insert, below, counted, left, added, summed, past, upward, halves, other, kept]) {
      let said: string;
      try { const c = lists[l]!(); said = show((run as any)(c, turn === 1 ? c : lists[(l + turn) % lists.length]!())); } catch (e) { said = "!" + (e as any).constructor.name; }
      console.log(l, run.name, said.slice(0, 160));
    }
