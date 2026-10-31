// A list goes through a generic helper that keeps it in a Map and comes out declared as an interface. A function that runs once adds one to it, and a getter and an
// arrow function capture the sum. Both are read afterwards.
function passThroughMap<V>(value: V): V {
  const map = new Map<string, V>();
  map.set("key", value);
  return map.get("key")!;
}
interface Holder {
  value: string[];
}
const kept: (() => unknown)[] = [];
function addOne(): void {
  const holder: Holder = passThroughMap<Holder>([1, 2] as any);
  const sum = (holder as any) + 1;
  const later = {
    get read() {
      return sum;
    },
  };
  console.log("getter", typeof later.read, later.read);
  kept.push(() => sum);
}
addOne();
console.log("arrow", typeof kept[0](), kept[0]());
