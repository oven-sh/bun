// In a validating build: the first turn of the loop throws in front of the inlined method, before the object that the method reads is declared.
function drive(o: Loud | null, n: number): number {
  let sum = 0, k = 0;
  do { sum += o!.step(k); } while (++k < n);
  return sum;
}
try { drive(null, 3); } catch { console.log("caught"); }
const table = { base: process.argv.length + 40, more: 2 };
class Loud { step(k: number): number { return k + table.base; } }
console.log(drive(new Loud(), 100000) > 0);
