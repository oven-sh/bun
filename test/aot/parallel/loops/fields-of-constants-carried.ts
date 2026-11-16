// Loops that read and store fields of objects which constants of the file hold: the loop carries the field, and memory has it in each turn.
// STATISTIC: SlotsCarriedAroundLoops >= 5
class Counter { n = 0; total = 0.5; add(x: number): this { this.n = (this.n + x) & 1023; return this; } step(x: number): void { this.total += x * 0.25; } }
const one = new Counter(), two = new Counter(), same = one;
const turns: number = JSON.parse("50");
function sums(turns: number): number { let n = 0; for (let k = 0; k < turns; k++) n += one.add(k & 3).n; return n; }
function fractions(turns: number): number { for (let k = 0; k < turns; k++) two.step(k); return two.total; }
function greatest(turns: number): number { for (let k = 0; k < turns; k++) { if (two.n < ((k * 7) & 31)) two.n = (k * 7) & 31; } return two.n; }
function counted(turns: number): number { let s = 0; for (let k = 0; k < turns; k++) { one.n++; s += one.n; } return s; }
function aliased(turns: number): string { let s = ""; for (let k = 0; k < turns; k++) { one.n++; same.n += 2; if (k % 10 === 0) s += one.n + " "; } return s; }
function poke(): void { same.n = 5; }
function poked(turns: number): number { let s = 0; for (let k = 0; k < turns; k++) { one.n++; if (k === 20) poke(); s += one.n; } return s; }
function left(turns: number): number { for (let k = 0; k < turns; k++) { one.n += 3; if (k === 7) return one.n; } return -1; }
function thrown(turns: number): number { try { for (let k = 0; k < turns; k++) { one.n += 3; if (k === 7) throw new RangeError("stop"); } } catch (e) { return one.n; } return -1; }
function nested(turns: number): number { let s = 0; for (let j = 0; j < 3; j++) { for (let k = 0; k < turns; k++) { one.n++; two.n = one.n; } s += two.n; } return s; }
for (let round = 0; round < 3; round++) console.log(sums(turns), fractions(turns), greatest(turns), counted(turns), aliased(turns), poked(turns), left(turns), thrown(turns), nested(turns), one.n, two.n, two.total);
one.n = 2147483640; console.log(counted(20), one.n);
(one as any).n = 1.5; console.log(counted(3), one.n);
Object.freeze(two); try { console.log(fractions(3)); } catch (e: any) { console.log(e.name, two.total); }
export {};
