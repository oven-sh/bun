// An init hook of node:async_hooks is handed an object that holds the callback and the arguments of process.nextTick, inside the call.
import { createHook } from "node:async_hooks";

class Counter {
  constructor(n) {
    this.n = n;
    this.list = [1, 2];
  }
  twice() {
    return this.n * 2;
  }
  total() {
    let sum = 0;
    for (let i = 0; i < this.list.length; i++) sum += this.list[i];
    return sum;
  }
}

const untouched = new Counter(4);
const counter = new Counter(21);
const calls = [];
const hook = createHook({
  init(id, type, trigger, resource) {
    if (type !== "TickObject" || !resource.args) return;
    const [first] = resource.args;
    first.n = "x";
    first.list.push("y");
    resource.callback("called by the hook");
  },
}).enable();
process.nextTick(value => calls.push(typeof value === "string" ? value : value.n), counter);
hook.disable();
console.log(typeof counter.n, counter.twice(), counter.total(), calls.join());
console.log(typeof untouched.n, untouched.twice(), untouched.total());
process.nextTick(() => console.log(calls.join()));
