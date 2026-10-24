// Receivers below an accessor: a getter that adds one to a number field throws a TypeError where the receiver that Reflect.get passes holds a bigint or a symbol in that field.
let total = 0;

class Meter {
  count = 1;
  get next(): number {
    return this.count + 1;
  }
}

const meter = new Meter();
total += meter.next;
for (const count of [2n, Symbol("s"), { valueOf: () => 3 }, null, undefined, "4", [5], true] as any[]) {
  try {
    const next: unknown = Reflect.get(meter, "next", { count });
    total += typeof next === "number" ? (Number.isNaN(next) ? 100 : next * 1000) : typeof next === "string" ? 100000 * next.length : 0;
  } catch (error) {
    total += error instanceof TypeError ? 10000000 : 0;
  }
}
console.log(total);
