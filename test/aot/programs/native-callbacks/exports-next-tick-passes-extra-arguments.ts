// Exports of start-up modules: the tick queue calls the function back with the extra arguments of process.nextTick, which are typed any[]; direct calls pass numbers.
let total = 0;

function add(a: number, b: number): void {
  total += typeof a === "number" ? a : typeof a === "string" ? 1000 : 100000;
  total += typeof b === "number" ? b : b === undefined ? 10000 : 1000000;
}

class Counter {
  count = 1;
  bump(by: number): void {
    total += this === undefined ? 10000000 : this.count + by;
  }
}

add(1, 2);
const counter = new Counter();
counter.bump(1);
process.nextTick(add, 3, 4);
process.nextTick(add, "three");
process.nextTick(add, { valueOf: () => 3 }, null);
process.nextTick(counter.bump, 5);
process.nextTick(add);
setImmediate(() => console.log(total));
