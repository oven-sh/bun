// f(a, b, ...rest) where f is known and takes a, b and a rest parameter: the compiler may hand the caller's rest array over instead of making a list and a third array.
// Nobody may be able to tell: every call of f gets an array of its own, and what f does to it shows nowhere else.
const lines = [];
const show = (...values) => lines.push(values.map(value => (Array.isArray(value) ? "[" + value.join() + "]" : String(value))).join(" "));
const opaque = value => (lines.length < 0 ? null : value);

const kept = [];
function keeps(a, b, ...rest) {
  kept.push(rest);
  rest.push(a + b);
  rest[0] = "changed";
  return rest;
}
function reads(a, b, ...rest) {
  let sum = a + b;
  for (let i = 0; i < rest.length; i++) sum += rest[i];
  return sum;
}

function forwards(...args) {
  return keeps(1, 2, ...args);
}
function forwardsAndReadsAgain(...args) {
  const result = keeps(1, 2, ...args);
  return [result.length, args.length, args[0], result === args];
}
const stored = [];
function storesThenForwards(...args) {
  stored.push(args);
  return keeps(1, 2, ...args);
}
function forwardsTwice(...args) {
  const first = keeps(1, 2, ...args);
  const second = keeps(3, 4, ...args);
  return [first === second, first, second, args];
}
function forwardsInLoop(times, ...args) {
  const results = [];
  for (let i = 0; i < times; i++) results.push(keeps(i, i, ...args));
  return [results.length, results[0] === results[1], results[0], results[1], args];
}
function forwardsOnOneWay(flag, ...args) {
  if (flag) return keeps(1, 2, ...args);
  stored.push(args);
  return args;
}
function changesThenForwards(...args) {
  args.extra = "named";
  args[Symbol.iterator] = function* () {
    yield "from";
    yield "iterator";
  };
  return keeps(1, 2, ...args);
}
function punchesHoleThenForwards(...args) {
  delete args[1];
  return keeps(1, 2, ...args);
}
function growsThenForwards(...args) {
  args.length = 5;
  return keeps(1, 2, ...args);
}
function forwardsUnderTry(...args) {
  try {
    return throws(1, 2, ...args);
  } catch (error) {
    return [error.message, args];
  }
}
function throws(a, b, ...rest) {
  rest[0] = "changed before the throw";
  throw new Error("thrown with " + rest.length);
}
const arrow = (...args) => keeps(1, 2, ...args);
function outer(...args) {
  return middle("m", ...args);
}
function middle(tag, ...args) {
  return keeps(tag, tag, ...args);
}
function withArguments(...args) {
  const result = keeps(1, 2, ...args);
  return [arguments.length, arguments[0], result];
}
function fewerInFront(...args) {
  return keeps(1, ...args);
}
function moreInFront(...args) {
  return keeps(1, 2, 3, ...args);
}
function moreBehind(...args) {
  return keeps(1, 2, ...args, "last");
}
function spreadsAnother(other, ...args) {
  return [keeps(1, 2, ...other), other, args];
}
class Base {
  collect(a, b, ...rest) {
    rest.unshift(this.name);
    kept.push(rest);
    return rest;
  }
}
class Derived extends Base {
  name = "derived";
  collect(...args) {
    return super.collect("x", "y", ...args);
  }
  viaThis(...args) {
    return this.collectOwn("x", "y", ...args);
  }
  collectOwn(a, b, ...rest) {
    rest.push(a, b, this.name);
    return rest;
  }
}
async function forwardsAsync(...args) {
  await null;
  return keeps(1, 2, ...args);
}
function* forwardsInGenerator(...args) {
  yield keeps(1, 2, ...args);
  yield args;
}
function sloppyThis(a, b, ...rest) {
  return [typeof this, rest];
}
function forwardsWithReceiver(receiver, ...args) {
  return sloppyThis.call(receiver, 1, 2, ...args);
}
function usesThis(a, b, ...rest) {
  return [this === undefined, rest];
}
function forwardsWithoutReceiver(...args) {
  return usesThis(1, 2, ...args);
}
function captures(tag) {
  function inner(a, b, ...rest) {
    rest.push(tag, a, b);
    return rest;
  }
  return (...args) => inner(tag, tag, ...args);
}
function readsFirst(...args) {
  const first = args.length > 0 ? args[0] : "none";
  return keeps(first, args.length, ...args);
}
function countsDown(n, total, ...rest) {
  "use strict";
  if (!n) return total + rest.length;
  return countsDown(n - 1, total + rest[0], ...rest);
}

for (let round = 0; round < 3; round++) {
  const a = opaque(forwards)(round, "b", "c");
  const b = opaque(forwards)(round, "b", "c");
  show("forwards", a, b, a === b, kept.at(-1) === b, kept.at(-2) === a);
  show("no arguments", opaque(forwards)(), opaque(forwards)().length);
  show("reads again", opaque(forwardsAndReadsAgain)(round, 7));
  const c = opaque(storesThenForwards)(round, 8);
  show("stored", c, stored.at(-1), c === stored.at(-1));
  show("twice", ...opaque(forwardsTwice)(round, 9));
  show("loop", ...opaque(forwardsInLoop)(2, round, 10));
  show("one way", opaque(forwardsOnOneWay)(true, round, 11), opaque(forwardsOnOneWay)(false, round, 12), stored.at(-1));
  show("changed", opaque(changesThenForwards)(round, 13));
  show("hole", opaque(punchesHoleThenForwards)(round, 14, 15));
  show("grown", opaque(growsThenForwards)(round, 16));
  show("try", ...opaque(forwardsUnderTry)(round, 17));
  show("arrow", opaque(arrow)(round, 18), opaque(arrow)(round, 18) === opaque(arrow)(round, 18));
  show("chain", opaque(outer)(round, 19), kept.at(-1));
  show("arguments", ...opaque(withArguments)(round, 20));
  show("fewer", opaque(fewerInFront)(round, 21), opaque(fewerInFront)());
  show("more", opaque(moreInFront)(round, 22));
  show("behind", opaque(moreBehind)(round, 23));
  const other = [round, 24];
  show("another", ...opaque(spreadsAnother)(other, 25), other);
  const derived = opaque(new Derived());
  show("super", derived.collect(round, 26), derived.viaThis(round, 27));
  show("generator", ...opaque(forwardsInGenerator)(round, 28));
  show("receiver", ...opaque(forwardsWithReceiver)(round, 29, 30), ...opaque(forwardsWithReceiver)(undefined, 31));
  show("no receiver", ...opaque(forwardsWithoutReceiver)(round, 37));
  show("captures", opaque(captures("t" + round))(round, 38));
  show("reads first", opaque(readsFirst)(round, 39), opaque(readsFirst)());
  show("direct", forwards(round, 32), forwardsTwice(round, 33)[3], reads(1, 2, ...[round, 34]));
}
show("async", await opaque(forwardsAsync)(35, 36));
show("deep", opaque(countsDown)(300000, 0, 1, 2, 3));
const long = new Array(70000).fill(1);
show("long", opaque(forwards).apply(null, long).length, opaque((...args) => reads(1, 2, ...args)).apply(null, long));
show("kept", kept.length, new Set(kept).size);
console.log(lines.join("\n"));
