// calls a method of an instance that was given an undeclared property under a key; the receiver's type is inferred
class Counter {
  count = 0;
  bump() {
    return ++this.count;
  }
}
const operations = 100;
const makeCounter = (i: number) => {
  const counter = new Counter();
  (counter as any)["key" + (i % 4)] = i;
  return counter;
};
const counters = [makeCounter(0)];
for (let i = 1; i < operations; i++) counters.push(makeCounter(i));
let total = 0;

kernel: {
  for (let i = 0; i < counters.length; i++) {
    const counter = counters[i];
    total += counter.bump();
  }
}

console.log(total);
