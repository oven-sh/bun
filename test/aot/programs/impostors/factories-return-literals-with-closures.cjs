function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

function makeCounter(start) {
  let count = start;
  return {
    step: 1,
    increment() {
      count += this.step;
      return count;
    },
    current() {
      return count;
    },
  };
}

function makeBackwardsCounter(start) {
  let count = start;
  return {
    step: 1,
    increment() {
      count -= this.step;
      return count;
    },
    current() {
      return "backwards " + count;
    },
  };
}

function makeCounterInAnotherOrder(start) {
  let count = start;
  return {
    current: () => "another order " + count,
    increment: function () {
      return (count += 10);
    },
    step: 1,
  };
}

function makeSharedCounter() {
  return sharedCounter;
}
const sharedCounter = makeCounter(1000);

function bump(counter) {
  return counter.increment();
}

function read(counter) {
  return counter.current();
}

function bumpTwiceAndRead(counter) {
  counter.increment();
  counter.increment();
  return counter.current();
}

const honest = makeCounter(0);
for (let i = 0; i < 2000; i++) bump(honest);
console.log("2000 honest increments", read(honest));

const first = makeCounter(10);
const second = makeCounter(20);
attempt("two counters of one factory keep their own counts", () => [bump(first), bump(first), bump(second), read(first), read(second)]);
attempt("their methods are different functions", () => first.increment === second.increment);

const borrowed = makeCounter(30);
borrowed.increment = first.increment;
attempt("a counter with another counter's increment", () => [bump(borrowed), read(borrowed), read(first)]);

const detached = second.increment;
attempt("increment detached from its object", () => detached());
attempt("increment with a literal as this", () => second.increment.call({ step: 5 }));
attempt("increment with a string step", () => { const counter = makeCounter(1); counter.step = "2"; return [bump(counter), bump(counter), read(counter)]; });
attempt("increment after step was deleted", () => { const counter = makeCounter(1); delete counter.step; return [bump(counter), read(counter)]; });
attempt("increment with step as a getter", () => { const counter = makeCounter(1); let calls = 0; Object.defineProperty(counter, "step", { get() { return ++calls; } }); return [bump(counter), bump(counter), bump(counter)]; });

const impostors = [
  ["the other factory", () => makeBackwardsCounter(5)],
  ["the same names in another order", () => makeCounterInAnotherOrder(5)],
  ["one object handed out every time", makeSharedCounter],
  ["a frozen counter", () => Object.freeze(makeCounter(5))],
  ["a copy by spread", () => ({ ...makeCounter(5) })],
  ["a copy by Object.create", () => Object.create(makeCounter(5))],
  ["a class instance", () => new (class { count = 5; step = 1; increment() { return (this.count += this.step); } current() { return "class " + this.count; } })()],
  ["a counter whose current is a number", () => Object.assign(makeCounter(5), { current: 5 })],
  ["a counter without increment", () => { const counter = makeCounter(5); delete counter.increment; return counter; }],
  ["a proxy around a counter", () => new Proxy(makeCounter(5), {})],
  ["increment replaced under a computed name", () => { const counter = makeCounter(5); counter[["incre", "ment"].join("")] = () => "computed increment"; return counter; }],
  ["increment turned into a getter", () => Object.defineProperty(makeCounter(5), "increment", { get() { return () => "increment from a getter"; } })],
  ["increment and current swapped", () => { const counter = makeCounter(5); [counter.increment, counter.current] = [counter.current, counter.increment]; return counter; }],
  ["increment deleted, one on a new prototype", () => { const counter = makeCounter(5); delete counter.increment; return Object.setPrototypeOf(counter, { increment() { return "inherited increment"; } }); }],
  ["the methods of another counter of the same factory", () => Object.assign(makeCounter(5), makeCounter(500))],
];

for (let round = 0; round < 2; round++) {
  for (const [label, make] of impostors) {
    attempt("round " + round + ", " + label + ": bump", () => bump(make()));
    attempt("round " + round + ", " + label + ": read", () => read(make()));
    attempt("round " + round + ", " + label + ": bump twice and read", () => bumpTwiceAndRead(make()));
    attempt("round " + round + ", honest again", () => bumpTwiceAndRead(makeCounter(0)));
  }
}
console.log("the honest counter was not touched", read(honest));
