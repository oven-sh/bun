function makeCounter() {
  class Counter {
    count = 0;
    increment(): number {
      return ++this.count;
    }
  }
  return new Counter();
}

const counter = makeCounter();
counter.increment();
console.log(counter.count);
