// STATISTIC: OwnKeyWalksExpanded >= 1
interface First { z: number; y: number }
interface Later { a: number; b: number }
let current: Later = { a: 0, b: 0 };
function born(z: number, y: number): First { return { z, y }; }
const tricky: any = { y: 2, w: 0 };
Object.defineProperty(tricky, "z", { get() { current.a = 10; return 3; }, enumerable: true });
function merge(first: First, start: number) {
  current = { a: start, b: 2 };
  return Object.assign({ id: 7, z: 0, y: 0, a: 0, b: 0 }, first, current);
}
let said = "";
for (const first of [born(1, 2), tricky, born(1, 2)]) {
  const made = merge(first, 1);
  said += ":" + made.a + "/" + made.z + "/" + made.id;
}
console.log(said);
