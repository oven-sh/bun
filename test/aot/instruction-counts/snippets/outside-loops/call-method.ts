// calls a method, outside loops
const operations = 4;
class Counter {
  count = 0;
  add(by: number): number {
    this.count += by;
    return this.count;
  }
}
let counter: Counter = new Counter();
let total = 0;

kernel: {
  total += counter.add(1);
  total += counter.add(2);
  total += counter.add(3);
  total += counter.add(4);
}

console.log(total);
