// A copy of every() walks the generator that it is passed. Where the function no longer makes plain generators, the call is made, with a generator of its own.
const log = [];
function* range(from, to, step = 1) {
  for (let i = from; i <= to; i += step) yield i;
}
function* pairs(from, to) {
  try {
    for (let i = from; i <= to; i++) yield [i, i * i];
  } finally {
    log.push("closed " + from);
  }
}
function isAsyncIterable(input) {
  if (typeof input !== "object" || input === null) return false;
  return input[Symbol.asyncIterator] !== undefined;
}
function every(predicate) {
  return function everyFn(data) {
    if (data == null) return false;
    if (isAsyncIterable(data) || data instanceof Promise) return "async";
    let i = 0;
    for (const datum of data) if (!predicate(datum, i++)) return false;
    return true;
  };
}
function filter(fn) {
  return function filterFn(data) {
    if (isAsyncIterable(data)) return "async";
    return {
      *[Symbol.iterator]() {
        let i = 0;
        for (const datum of data) if (fn(datum, i++)) yield datum;
      },
    };
  };
}
function attempt(f) {
  try {
    return f();
  } catch (e) {
    return e.name + ": " + e.message;
  }
}
const isPrime = n => every(x => n % x)(range(2, n - 1));
const factors = n => [...filter(x => !(n % x))(range(1, n))];
const firstPair = n => every(([x, y]) => x + y < n)(pairs(1, n));
function primes(limit) {
  let found = "";
  for (let n = 2; n < limit; n++) if (isPrime(n)) found += n + " ";
  return found;
}
for (let turn = 0; turn < 3; turn++) console.log(primes(40), factors(60).join(), firstPair(9), log.splice(0).join());

// One prototype for all generators of a function, whoever makes them.
const one = range(1, 2), two = range(3, 4);
console.log(Object.getPrototypeOf(one) === range.prototype, Object.getPrototypeOf(one) === Object.getPrototypeOf(two), one instanceof range, Object.keys(range.prototype).length);
console.log(primes(20), factors(12).join());

// Something is laid above the generators of one function, and taken away.
range.prototype[Symbol.asyncIterator] = 1;
console.log(attempt(() => primes(10)), attempt(() => isPrime(7)), attempt(() => factors(6).join()));
delete range.prototype[Symbol.asyncIterator];
console.log(primes(20), factors(12).join());
let steps = 0;
range.prototype.next = function () {
  return steps++ < 2 ? { done: false, value: 1 } : { done: true };
};
console.log(isPrime(9), isPrime(4), steps, attempt(() => factors(8).join()), steps);
delete range.prototype.next;
console.log(primes(20), factors(12).join());
const asMade = range.prototype;
range.prototype = { __proto__: asMade, [Symbol.iterator]: () => [2, 3][Symbol.iterator]() };
console.log(isPrime(25), isPrime(9), attempt(() => factors(25).join()), Object.getPrototypeOf(range(1, 2)) === range.prototype);
range.prototype = 5;
console.log(isPrime(25), isPrime(9), factors(25).join(), Object.getPrototypeOf(range(1, 2)) === Object.getPrototypeOf(asMade));
range.prototype = asMade;
console.log(primes(20), factors(12).join(), Object.getPrototypeOf(range(1, 2)) === asMade);
Object.setPrototypeOf(asMade, { __proto__: Object.getPrototypeOf(asMade), return() { log.push("return"); return {}; } });
console.log(isPrime(9), isPrime(7), factors(9).join(), log.splice(0).join());
Object.setPrototypeOf(asMade, Object.getPrototypeOf(Object.getPrototypeOf(asMade)));
console.log(isPrime(9), primes(12), log.splice(0).join());

// The next of generators on what is no generator.
const next = Object.getPrototypeOf(asMade).next;
const impostor = { [Symbol.iterator]() { return this; }, next };
const half = range(1, 9);
half.next();
const lent = { [Symbol.iterator]: () => half };
const bound = { [Symbol.iterator]: () => ({ next: next.bind(range(1, 3)) }) };
function total(data) {
  let sum = 0;
  for (const x of data) sum += x;
  return sum;
}
for (const data of [range(1, 4), [1, 2], impostor, new Set([4, 5]), lent, half, bound, impostor, "12", range(0, 2), new Map([[1, 2]]).keys(), impostor]) console.log(attempt(() => total(data)));
for (const data of [impostor, range(1, 3), impostor]) console.log(attempt(() => [...filter(x => x > 1)(data)].join()), attempt(() => every(x => x < 9)(data)));

// A generator that is stepped while it runs, and one that a loop leaves.
function* selfish() {
  yield 1;
  yield total(self);
}
const self = selfish();
console.log(attempt(() => total(self)), attempt(() => total(self)));
const left = range(1, 5);
for (const x of left) if (x === 2) break;
console.log(left.next().done, total(left), total(range(1, 5)));
const kept = [];
for (let i = 0; i < 4; i++) {
  const data = range(1, i);
  kept.push(every(x => x < 3)(data));
  kept.push(data.next().done);
}
console.log(kept.join());
console.log(attempt(() => every(x => { if (x === 3) throw new Error("three"); return true; })(range(1, 5))), attempt(() => every(() => true)(range(2n, 3n))), attempt(() => isPrime({ valueOf: () => 7 })), attempt(() => isPrime(Symbol("s"))));
