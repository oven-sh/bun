// Literals whose methods stand in front of, between and behind their fields: every member is there for whoever gets the object, in the order written.
const base = { greet() { return 1; }, twice(x) { return x * 2; }, arrow: (x) => x + 1, n: 4 };
function makeCounter(start) {
  return {
    step() { this.count++; return this.count; },
    count: start,
    reset() { this.count = 0; return this; },
    limit: start + 10,
  };
}
function makeHeir(start) {
  return {
    __proto__: base,
    first: start,
    greet() { return super.greet() + this.first + this.last; },
    last: start + 1,
  };
}
function makeGenerated(start) {
  return {
    *values() { yield this.from; yield this.from + 1; },
    from: start,
    async later() { return this.from; },
    ["computed" + start % 2]() { return this.from; },
    tail: start * 2,
  };
}
function makeAccessor(start) {
  return {
    step() { return 1; },
    count: start,
    get value() { return this.count; },
    tail: start + 2,
  };
}
let sum = 0, previous = null;
for (let i = 0; i < 3000; i++) {
  const counter = makeCounter(i), heir = makeHeir(i);
  sum += counter.step() + counter.limit + base.greet() + base.twice(i) + base.arrow(i) + base.n + heir.greet() + heir.last;
  if (previous && (previous.step === counter.step || previous.reset === counter.reset)) sum += 1e9;
  if (counter.step !== counter.step || counter.reset() !== counter) sum += 1e9;
  previous = counter;
}
console.log(sum, Object.keys(base).join(), Object.keys(previous).join(), Object.keys(makeHeir(1)).join());
console.log(previous.step.name, previous.step.length, typeof previous.step.prototype, base.twice.name, base.arrow.name);
const generated = makeGenerated(3);
console.log(Object.keys(generated).join(), [...generated.values()].join(), generated.computed1(), generated.tail, await generated.later());
for (let i = 0; i < 3; i++) {
  const made = makeAccessor(i);
  console.log(Object.keys(made).join(), JSON.stringify(made), made.value + made.tail, Object.entries(made).length);
}
try {
  new previous.step();
} catch (error) {
  console.log(error instanceof TypeError);
}
