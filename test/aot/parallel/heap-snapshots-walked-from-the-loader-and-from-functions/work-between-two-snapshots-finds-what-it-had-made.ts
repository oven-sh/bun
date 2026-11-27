// A heap snapshot rides on a full collection. What compiled code has made for later (the structure of an instance that took one more member, what a site
// has learned) is kept by such a collection as long as its prototype and its realm live, also when no object of it is left. A snapshot keeps as much:
// the work behind it makes no structure anew. The collector's verifier looks on.
// Env of the executable: BUN_JSC_verifyGC=1
// COUNTER: CompiledStructuresCreated <= 2
const unseen = <T>(value: T): T => [value][JSON.parse("0")];
class Leaf {
  first = 1;
  second = 2;
}
class Twig {
  zeroth = 0;
  first = 1;
  second = 2;
}
function read(shelf: any): number {
  return shelf.first + shelf.second + (shelf.later ?? 0);
}
function round(): number {
  let sum = 0;
  for (let i = 0; i < 1000; i++) {
    const shelf: any = unseen(JSON.parse(String(i % 2)) ? new Twig() : new Leaf());
    shelf.later = 3;
    sum += read(shelf);
  }
  return sum;
}
const before = round();
Bun.gc(true);
Bun.generateHeapSnapshot();
let names = 0;
for (let i = 0; i < 4000; i++) names += Object.keys({ ["k" + i]: i, ["j" + i]: i }).length;
const between = round();
Bun.generateHeapSnapshot();
console.log(before, names, between, round());
