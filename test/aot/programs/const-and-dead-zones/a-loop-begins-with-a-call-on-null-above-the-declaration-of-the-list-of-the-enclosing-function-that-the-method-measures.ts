// The first turn of the loop throws in front of the inlined method, before the list of the enclosing function that the method measures and reads is declared.
function main() {
  function drive(o: Loud | null, n: number): number {
    let sum = 0, k = 0;
    do { sum += o!.step(k); } while (++k < n);
    return sum;
  }
  try { drive(null, 3); } catch { console.log("caught"); }
  const list: number[] = Array.from({ length: process.argv.length + 3 }, (_, k) => k);
  class Loud { step(k: number): number { return k + list.length + list[1]!; } }
  console.log(drive(new Loud(), 100000) > 0);
}
main();
