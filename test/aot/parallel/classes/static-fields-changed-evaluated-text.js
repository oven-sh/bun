// Evaluated text holds two classes and stores to their static fields, shadows them below, deletes them, turns them into accessors, freezes the class and relinks the subclass. Every read and every store afterward does what plain JavaScript does.
class Counter {
  static count = 1;
  static label = "start";
  static total() {
    return Counter.count + Below.count;
  }
}
class Below extends Counter {
  static own = 10;
}
class Untouched {
  static count = 100;
}

function show(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function readAll() {
  let line = "";
  for (let round = 0; round < 3; round++) {
    line = [
      Counter.count,
      Below.count,
      Counter.label,
      Below.label,
      Below.own,
      Untouched.count,
      "count" in Counter,
      "count" in Below,
      Object.hasOwn(Below, "count"),
      Counter.total(),
    ]
      .map(show)
      .join(" ");
  }
  return line;
}

function storeAll(value) {
  let outcome = "";
  for (let round = 0; round < 3; round++) {
    try {
      Counter.count = value + round;
      Counter.label = "label " + (value + round);
      outcome = "stored";
    } catch (error) {
      outcome = error.constructor.name;
    }
  }
  return outcome;
}

const steps = [
  "Counter.count = 2",
  "Counter.count = 2.5",
  "Counter.count = 'text'",
  "Counter.count = 3",
  "Below.count = 4",
  "delete Below.count",
  "delete Counter.count",
  "Counter.count = 5",
  "Object.defineProperty(Counter, 'count', { get() { return 'getter'; }, set(value) { this.seen = value; }, configurable: true })",
  "Object.defineProperty(Counter, 'count', { value: 6, writable: true, enumerable: true, configurable: true })",
  "Object.defineProperty(Counter, 'label', { value: 'fixed', writable: false })",
  "Object.setPrototypeOf(Below, { count: 'elsewhere', label: 'elsewhere' })",
  "Object.setPrototypeOf(Below, Counter)",
  "Below.own += 1",
  "Object.freeze(Counter)",
];

const change = new Function("Counter", "Below", "text", "return new Function('Counter', 'Below', text)(Counter, Below);");

console.log("at the start:", readAll());
for (const [index, step] of steps.entries()) {
  change(Counter, Below, step);
  console.log(step, "=>", readAll());
  console.log("  then stores from", index * 10, storeAll(index * 10), readAll());
}
console.log("seen by the setter:", show(Counter.seen));
console.log(Object.keys(Counter).join(), "|", Object.keys(Below).join(), "|", Object.keys(Untouched).join());
