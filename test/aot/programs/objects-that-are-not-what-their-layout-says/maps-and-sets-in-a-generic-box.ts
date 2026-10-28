// A generic box typed with an interface holds a literal, a Map and a Set
class Box<T> {
  constructor(public held: T) {}
  get(): T {
    return this.held;
  }
}
interface HasSize {
  size: number;
}
function tell(b: Box<HasSize>): string {
  const v = b.get();
  return v.size + "|" + (v instanceof Map) + "|" + (v instanceof Set) + "|" + Object.keys(v).join();
}
const list: Box<HasSize>[] = [new Box({ size: 1 }), new Box(new Map([[1, 1]])), new Box(new Set([1, 2]))];
for (let round = 0; round < 3; round++) for (const b of list) console.log(tell(b));
