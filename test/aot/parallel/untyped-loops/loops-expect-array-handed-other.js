// A loop that is predicted to walk an array is handed a string, a set, a map, a generator, built-in iterators and iterators of the program's own: what is opened, stepped and closed, how often and in which order, and which error wins, is what plain Bun does.
function sum(values, weigh) {
  let total = 0;
  for (const value of values) total += weigh(value);
  return total;
}
function first(values) {
  for (const value of values) {
    if (value) return value;
  }
  return null;
}
function pairs(values) {
  const found = [];
  outer: for (const a of values) {
    for (const b of values) {
      if (a === b) continue outer;
      found.push(`${String(a)}${String(b)}`);
      if (found.length > 5) break outer;
    }
  }
  return found.join(" ");
}
function* count() {
  try {
    yield 1;
    yield 2;
    yield 3;
  } finally {
    console.log("the generator is closed");
  }
}
class Countdown {
  constructor(from) {
    this.left = from;
    this.closed = 0;
    this.steps = 0;
  }
  [Symbol.iterator]() {
    return this;
  }
  next() {
    this.steps++;
    return this.left > 0 ? { done: false, value: this.left-- } : { done: true, value: "never read" };
  }
  return() {
    this.closed++;
    return {};
  }
}
const weigh = value => (typeof value === "number" ? value * 2 : typeof value === "string" ? value.length : 1);
const make = [() => [1, 2, 3], () => "a\u{1F600}b", () => new Set([4, 5]), () => new Map([[1, 2]]), () => count(), () => new Countdown(3), () => new Map([["k", 1]]).keys(), () => [7, 8].entries(), () => ""];
for (const one of make) console.log(sum(one(), weigh), String(first(one())), pairs(one()));

const left = new Countdown(3);
console.log(first(left), left.closed, left.steps);
const thrown = new Countdown(3);
try {
  sum(thrown, () => {
    throw new Error("out of the body");
  });
} catch (error) {
  console.log(error.message, thrown.closed, thrown.steps);
}
const throwsWhenClosed = { [Symbol.iterator]() { return this; }, next() { return { done: false, value: 1 }; }, return() { throw new Error("out of return"); } };
try {
  first(throwsWhenClosed);
} catch (error) {
  console.log(error.message);
}
try {
  sum(throwsWhenClosed, () => {
    throw new Error("the body's own");
  });
} catch (error) {
  console.log(error.message);
}
const throwsAtStep = { closed: 0, [Symbol.iterator]() { return this; }, next() { throw new Error("out of next"); }, return() { this.closed++; return {}; } };
try {
  sum(throwsAtStep, weigh);
} catch (error) {
  console.log(error.message, throwsAtStep.closed);
}
for (const wrong of [undefined, null, 5, {}, { [Symbol.iterator]: 1 }, { [Symbol.iterator]() { return 1; } }, { [Symbol.iterator]() { return { next() { return 1; } }; } }, { [Symbol.iterator]() { return {}; } }]) {
  try {
    console.log(sum(wrong, weigh));
  } catch (error) {
    console.log(error.constructor.name);
  }
}
const returnsNoObject = { [Symbol.iterator]() { return this; }, next() { return { done: false, value: 1 }; }, return() { return 1; } };
try {
  console.log(first(returnsNoObject));
} catch (error) {
  console.log(error.constructor.name);
}
const nextIsReadOnce = { reads: 0, [Symbol.iterator]() { return this; }, get next() { this.reads++; let left = 2; return () => ({ done: left-- <= 0, value: left }); } };
console.log(sum(nextIsReadOnce, weigh), nextIsReadOnce.reads);
