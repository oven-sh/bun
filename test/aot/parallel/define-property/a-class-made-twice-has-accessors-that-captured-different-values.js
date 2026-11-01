// Each evaluation of the class has function objects of its own.
"use strict";
function makeClass(step) {
  class Counter {
    count = 0;
    get next() {
      return this.count + step;
    }
    set next(value) {
      this.count = value * step;
    }
  }
  return Counter;
}
function makeFunction(step) {
  function Counter() {
    this.count = 0;
  }
  Object.defineProperty(Counter.prototype, "next", {
    get() {
      return this.count + step;
    },
    set(value) {
      this.count = value * step;
    },
  });
  return Counter;
}
function run(counters, turn) {
  let sum = 0;
  for (const counter of counters) {
    counter.next = turn++ & 7;
    sum += counter.next;
  }
  return sum;
}
for (const make of [makeClass, makeFunction]) {
  const counters = [];
  for (let step = 1; step < 4; step++) counters.push(new (make(step))(), new (make(step))());
  let sum = 0;
  for (let turn = 0; turn < 5000; turn++) sum += run(counters, turn);
  console.log(sum);
}
