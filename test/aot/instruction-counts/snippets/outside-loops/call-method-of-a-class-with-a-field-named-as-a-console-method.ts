// calls a method of a class whose field has the name of a method of the console, in a program that holds the console's constructor, outside loops
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
if (process.argv.length > 50) new (console as any).Console(process.stdout).count();

kernel: {
  total += counter.add(1);
  total += counter.add(2);
  total += counter.add(3);
  total += counter.add(4);
}

console.log(total);
