// Variables that callees of a loop step and the loop reads: they come round in registers.
let counted = 0, doubled = 0.5, late = 2147483600, words: any = 1;
function inFinally(x: number): number { try { return x; } finally { counted++; } }
function sometimes(x: number): number { if (x & 1) counted--; return x; }
function grows(x: number): number { late++; return x; }
function halves(x: number): number { doubled += 0.25; return x; }
function throwsOnce(x: number): number { try { if (x === 6) throw new Error("six"); return x; } finally { counted++; } }
function changes(x: number): number { if (x === 5) words = "w"; else words++; return x; }
function repeat(turns: number): number { let n = 0; for (let k = 0; k < turns; k++) n += inFinally(k & 7) + (counted & 1); return n; }
function both(turns: number): number { let n = 0; for (let k = 0; k < turns; k++) { n += sometimes(k & 3) + (counted & 3); n += inFinally(k & 1); } return n; }
function past(turns: number): number { let n = 0; for (let k = 0; k < turns; k++) n += grows(k & 3) + (late > 2147483647 ? 1 : 0); return n; }
function fractions(turns: number): number { let n = 0; for (let k = 0; k < turns; k++) n += halves(k & 3) + doubled; return n; }
function caught(turns: number): number { let n = 0; for (let k = 0; k < turns; k++) { try { n += throwsOnce(k & 7); } catch { n -= counted; } } return n; }
function turned(turns: number): string { let s = ""; for (let k = 0; k < turns; k++) { changes(k & 7); s += words; } return s; }
function nested(turns: number): number { let n = 0; for (let m = 0; m < 3; m++) for (let k = 0; k < turns; k++) n += inFinally(m) + (counted & 1); return n; }
function early(turns: number): number { let n = 0; for (let k = 0; k < turns; k++) { n += inFinally(k & 1); if (counted > 2000) break; } return n; }
function make() {
  let c = 0, d = 0;
  const step = (x: number) => { try { return x; } finally { c++; d += x; } };
  const run = (turns: number) => { let n = 0; for (let k = 0; k < turns; k++) n += step(k & 7) + (c & 1); return n; };
  return { run, peek: () => [c, d] };
}
console.log(repeat(0), repeat(1), repeat(1000), counted);
console.log(both(777), counted);
console.log(past(200), late);
console.log(fractions(100), doubled);
console.log(caught(50), counted);
console.log(turned(20), words);
console.log(nested(100), counted, early(1000), counted);
const a = make(), b = make();
console.log(a.run(1000), b.run(3), a.run(5), a.peek().join(), b.peek().join());
function tooEarly(x: number): number { try { return x; } finally { unborn++; } }
function dead(turns: number): number { let n = 0; for (let k = 0; k < turns; k++) n += tooEarly(k) + (unborn & 1); return n; }
try { console.log(dead(3)); } catch (e) { console.log((e as Error).name); }
console.log(dead(0));
let unborn = 4;
console.log(dead(100), unborn);
