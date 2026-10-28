// The first turn of a counted loop throws in front of the inlined method, before the list that the method measures and reads is declared.
function drive(o: Loud | null): number {
  let sum = 0;
  for (let k = 0; k < 100000; k++) sum += o!.step(k);
  return sum;
}
try { drive(null); } catch { console.log("caught"); }
const list: number[] = Array.from({ length: process.argv.length + 3 }, (_, k) => k);
class Loud { step(k: number): number { return k + list.length + list[1]!; } }
console.log(drive(new Loud()) > 0);
