// calls a method of an instance that was given an undeclared property under a key; the receiver's type is declared
class Counter {
  count = 0;
  bump(): number {
    return ++this.count;
  }
}
const operations = 100;
const counters: Counter[] = [];
for (let i = 0; i < operations; i++) {
  const counter = new Counter();
  (counter as any)["key" + (i % 4)] = i;
  counters.push(counter);
}
const call = (counter: Counter): number => counter.bump();
let total = 0;

kernel: {
  for (let i = 0; i < counters.length; i++) total += call(counters[i]);
}

console.log(total);
