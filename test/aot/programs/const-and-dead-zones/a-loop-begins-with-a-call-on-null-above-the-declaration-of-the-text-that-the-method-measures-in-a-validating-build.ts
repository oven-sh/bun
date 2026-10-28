// In a validating build: the first turn of the loop throws in front of the inlined method, before the text that the method measures is declared.
function drive(o: Loud | null, n: number): number {
  let sum = 0, k = 0;
  do { sum += o!.step(k); } while (++k < n);
  return sum;
}
try { drive(null, 3); } catch { console.log("caught"); }
const text = "x".repeat(process.argv.length + 3);
class Loud { step(k: number): number { return k + text.length; } }
console.log(drive(new Loud(), 100000) > 0);
