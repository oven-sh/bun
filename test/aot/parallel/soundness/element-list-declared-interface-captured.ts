// A list goes through a generic helper that keeps it in a Map and comes out declared as an interface. A function that runs once reads an element of it by index,
// and an arrow function that nobody calls captures the element.
function passThroughMap<V>(value: V): V {
  const map = new Map<string, V>();
  map.set("key", value);
  return map.get("key")!;
}
interface Holder {
  value: string[];
}
function readSecond(): void {
  const holder: Holder = passThroughMap<Holder>([undefined, undefined] as any);
  const second = (holder as any)[1];
  const readLater = () => second;
}
readSecond();
console.log("end");
