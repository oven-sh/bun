// calls a method of an instance that was given an undeclared property under a key, through a parameter of type any
class Counter {
  count = 0;
  bump(): number {
    return ++this.count;
  }
}
const operations = 20;
const counters: any[] = [];
for (let i = 0; i < operations; i++) {
  const counter: any = new Counter();
  counter["key" + (i % 4)] = i;
  counters.push(counter);
}
const call = (counter: any): number => counter.bump();
let total = 0;

kernel: {
  for (let i = 0; i < counters.length; i++) total += call(counters[i]);
}

console.log(total);
