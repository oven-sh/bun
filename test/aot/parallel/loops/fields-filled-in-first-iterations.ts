// A loop that fills a field where it finds it empty reads the field once: its first iteration runs apart, and every other finds the field filled.
// STATISTIC: FilledSlotGuardsHoisted >= 2
let made = 0;
function make(seed: number): number[] { made++; return [seed, 2, 3, 4]; }
class Lazy {
  private t: number[] | null = null;
  name: string | undefined = undefined;
  get table(): number[] { return (this.t ??= [1, 2, 3, 4]); }
  get built(): number[] { if (this.t === null) this.t = make(7); return this.t; }
  reset(): void { this.t = null; }
  sum(n: number): number { let s = 0; for (let i = 0; i < n; i++) s += (this.t ??= make(i))[i & 3]!; return s; }
}
const lazy = new Lazy();
function ofFile(n: number): number { let s = 0; for (let i = 0; i < n; i++) s += lazy.table[i & 3]!; return s; }
function ofParameter(o: Lazy, n: number): number { let s = 0; for (let i = 0; i < n; i++) s += o.built[i & 3]!; return s; }
function resets(o: Lazy, n: number): number { let s = 0; for (let i = 0; i < n; i++) { s += o.built[0]!; if (i % 3 === 2) o.reset(); } return s; }
function nested(o: Lazy, n: number): number { let s = 0; for (let k = 0; k < 2; k++) { o.reset(); for (let i = 0; i < n; i++) s += o.table[k]!; } return s; }
function sometimes(o: Lazy, n: number): number { let s = 0; for (let i = 0; i < n; i++) if (i & 1) s += o.table[i & 3]!; return s; }
function grows(o: Lazy, n: number): number { let s = 0; for (let i = 0; i < n; i++) { o.table.push(i); s += o.table.length; } return s; }
function same(o: Lazy, n: number): boolean { let first: number[] | null = null, is = true; for (let i = 0; i < n; i++) { const t = o.table; is = is && (first === null || first === t); first = t; } return is; }
function throws(n: number): string { const o = new Lazy(); let s = 0; try { for (let i = 0; i < n; i++) { s += o.built[i & 3]!; if (i === 3) throw new Error("left"); } } catch (e) { return (e as Error).message + s; } return "done" + s; }
const objects: Lazy[] = []; for (let i = 0; i < 40; i++) objects.push(new Lazy());
let at = 0; function next(): Lazy { return objects[at++ % 40]!; }
console.log(ofFile(0), ofFile(1), ofFile(9), ofFile(8), made);
for (const n of [0, 1, 2, 5, 9]) console.log(n, ofParameter(next(), n), next().sum(n), resets(next(), n), nested(next(), n), sometimes(next(), n), grows(next(), n), same(next(), n), throws(n), made);
for (const o of [objects[3]!, objects[4]!, lazy, lazy]) { console.log(ofParameter(o, 6), o.sum(4), nested(o, 3), sometimes(o, 5), grows(o, 2), same(o, 4), made); o.reset(); }
