// Every turn of the loop throws in front of the inlined method and catches it, before the typed array that the method reads, and that a conversion may replace, is declared.
function drive(o: Loud | null, n: number): number { let caught = 0; for (let k = 0; k < n; k++) { try { o!.step(k); } catch { caught++; } } return caught; }
console.log(drive(null, 100000));
let samples: Float64Array = Float64Array.from({ length: 8 }, (_, k) => k / 3);
let extra: any = JSON.parse("1");
let total = 0;
function swap(): number { samples = new Float64Array(4); return 1; }
class Loud { step(k: number): void { total = (total + samples[k & 3]! + extra) | 0; } }
console.log(drive(new Loud(), 100000), total);
extra = { valueOf: swap };
console.log(drive(new Loud(), 10), total);
