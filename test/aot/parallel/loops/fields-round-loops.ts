// Loops that read and store a field of an object which stays the same in them, reached by an arrow's this, a captured constant, a field, an element, while the same object is stored by other names.
// STATISTIC: SlotsCarriedAroundLoops >= 4
class Counter { n = 0; total = 0.5; inc = (): number => { this.n = (this.n + 1) & 255; return this.n; }; grow = (x: number): number => { this.total = this.total * 1.25 + x; return this.total; }; step(x: number): number { this.n += x; return this.n; } }
const one = new Counter(), inc = one.inc, grow = one.grow, same = one, other = new Counter();
const turns: number = JSON.parse("40"); let off: number = JSON.parse("9");
const captured = (() => { const c = new Counter(); return (x: number): number => c.step(x); })();
const held = { counter: new Counter() }, list = [new Counter()];
function arrows(turns: number): number { let s = 0; for (let i = 0; i < turns; i++) s += inc(); return s; }
function fractions(turns: number): number { let s = 0; for (let i = 0; i < turns; i++) { s += grow(i); if (i % 7 === 6) same.total = 1; } return s; }
function aliased(turns: number): number { let s = 0; for (let i = 0; i < turns; i++) { s += inc(); same.n = 40; s += same.n; } return s; }
function sometimes(turns: number): number { let s = 0; for (let i = 0; i < turns; i++) { if (i % 3 === 1) continue; s += inc(); if (i === off) same.n = 7; } return s; }
function beside(turns: number): number { let s = 0; for (let i = 0; i < turns; i++) { s += inc(); other.n = i; s += other.n; } return s; }
function captures(turns: number): number { let s = 0; for (let i = 0; i < turns; i++) s += captured(i); return s; }
function fields(turns: number): number { let s = 0; for (let i = 0; i < turns; i++) s += held.counter.step(i); return s; }
function elements(turns: number): number { let s = 0; for (let i = 0; i < turns; i++) s += list[0]!.step(i); return s; }
function nested(turns: number): number { let s = 0; for (let j = 0; j < 4; j++) { for (let i = 0; i < turns; i++) s += inc(); same.n = j; } return s; }
function unrolled(turns: number): number { let s = 0; for (let j = 0; j < turns; j++) { for (let i = 0; i < 2; i++) { one.n = (one.n + i) & 255; if (i === 1) other.n = 3; s += one.n; } } return s; }
function left(turns: number): number { for (let i = 0; i < turns; i++) if (inc() === 200) return i; return -1; }
for (let round = 0; round < 3; round++) console.log(arrows(turns), fractions(turns), aliased(turns), sometimes(turns), beside(turns), captures(turns), fields(turns), elements(turns), nested(turns), unrolled(turns), left(300), one.n, one.total, other.n);
one.n = 2147483640; let t = ""; for (let i = 0; i < 12; i++) t += one.step(1) + " "; console.log(t);
(one as any).n = "text"; t = ""; for (let i = 0; i < 3; i++) t += one.step(1) + " "; console.log(t);
Object.freeze(list[0]); try { elements(2); } catch (e: any) { console.log(e.name, list[0]!.n); }
export {};
