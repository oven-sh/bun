// The first turn of the loop throws in front of the inlined method, before the typed array that the method reads is declared.
function drive(o: Loud | null, n: number): number {
  let sum = 0, k = 0;
  do { sum += o!.step(k); } while (++k < n);
  return sum;
}
try { drive(null, 3); } catch { console.log("caught"); }
const samples = Float64Array.from({ length: 8 }, (_, k) => k / 3);
class Loud { step(k: number): number { return k + samples[k & 3]! + samples.length; } }
console.log(drive(new Loud(), 100000) > 0);
