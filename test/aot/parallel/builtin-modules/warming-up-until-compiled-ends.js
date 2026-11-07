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
  const deadline = Date.now() + 30_000;
  for (let calls = 0; numberOfDFGCompiles(fn) === 0 && Date.now() < deadline; calls++) call(calls);
  return numberOfDFGCompiles(fn) > 0 ? "compiled" : "never compiled";
}

let sum = 0;
const counter = new Counter();
const double = x => x * 2;
console.log("function", warmUp(add, i => (sum = add(sum, i) | 0)));
console.log("method", warmUp(Counter.prototype.step, () => counter.step()));
console.log("arrow", warmUp(double, i => double(i)));
console.log("not a function", numberOfDFGCompiles({}), numberOfDFGCompiles(1), numberOfDFGCompiles(undefined));

/* Output:
function compiled
method compiled
arrow compiled
not a function 0 0 0
*/
