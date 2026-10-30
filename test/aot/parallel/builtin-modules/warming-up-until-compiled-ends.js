import { numberOfDFGCompiles } from "bun:jsc";

function add(a, b) {
  return a + b;
}

class Counter {
  count = 0;
  step() {
    return ++this.count;
  }
}

function warmUp(fn, call) {
  let calls = 0;
  while (calls < 1_000_000 && numberOfDFGCompiles(fn) === 0) {
    call(calls);
    calls++;
  }
  return { ended: calls < 1_000_000, compiled: numberOfDFGCompiles(fn) > 0 };
}

let sum = 0;
const counter = new Counter();
const double = x => x * 2;
console.log("function", warmUp(add, i => (sum = add(sum, i) | 0)));
console.log("method", warmUp(Counter.prototype.step, () => counter.step()));
console.log("arrow", warmUp(double, i => double(i)));
console.log("not a function", numberOfDFGCompiles({}), numberOfDFGCompiles(1), numberOfDFGCompiles(undefined));
