// One, two, four and five listeners under names that nobody knows at the call, each entered by call and by apply with the emitter as `this`; one writes on it, one reads what the other wrote, one swaps its prototype.
class Emitter {
  constructor() {
    this.listeners = new Map();
    this.seen = 0;
  }
  on(name, listener) {
    this.listeners.set(name, listener);
    return this;
  }
  emit(name, value) {
    const listener = this.listeners.get(name);
    if (!listener) return undefined;
    return value % 2 ? listener.call(this, value) : listener.apply(this, [value]);
  }
}
class Counter extends Emitter {
  constructor(step) {
    super();
    this.step = step;
  }
  total() {
    return this.seen * this.step;
  }
}
const names = ["add", "read", "late", "swap", "plain"];
for (const count of [1, 2, 4, 5]) {
  const counter = new Counter(count);
  const listeners = [
    function (value) {
      this.seen += value;
      return this.seen;
    },
    function (value) {
      return this.total() + value;
    },
    function (value) {
      this.late = value;
      return Object.keys(this).join();
    },
    function () {
      Object.setPrototypeOf(this, { total: () => -1, emit: Emitter.prototype.emit });
      return this.total();
    },
    value => value,
  ];
  for (let index = 0; index < count; index++) counter.on(names[index], listeners[index]);
  const answers = [];
  for (let turn = 1; turn <= 6; turn++) for (const name of names) answers.push(counter.emit(name, turn));
  console.log(count, JSON.stringify(answers), counter.total(), counter instanceof Counter);
}
