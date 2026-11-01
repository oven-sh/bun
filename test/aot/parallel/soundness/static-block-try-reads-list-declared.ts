// A class with a static block stands in a try block at the top level. The block takes a list that is declared as an interface out of a generic helper, reads an element
// by index, and then makes an object whose computed key names a variable that nobody declares. A getter inside that object captures the element, a variable that is
// declared but never assigned, and `this`.
function passThroughMap<V, K extends string = "key">(value: V): V {
  const map = new Map<K, V>();
  map.set("key" as K, value);
  return map.get("key" as K)!;
}
interface Holder {
  value: string[];
}
let neverAssigned!: number[];
try {
  class WithBlock {
    static {
      const holder: Holder = passThroughMap<Holder>([undefined, undefined, undefined, undefined] as any);
      const second = (holder as any)[1];
      const made = {
        // @ts-ignore
        [undeclared as any]() {
          const inner = {
            get b() {
              class Taker {}
              new (Taker as any)(second, neverAssigned, this);
              return 1;
            },
          };
        },
      };
    }
  }
} catch (error) {
  console.log("caught", String(error));
}
console.log("end", neverAssigned);
