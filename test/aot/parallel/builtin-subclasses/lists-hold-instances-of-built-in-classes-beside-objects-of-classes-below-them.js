// What Date makes for `super()` of a class below it is a date, with the prototype of that class. So a list that holds dates and objects of classes below Date is a list of dates:
// JSON.stringify writes each plain date straight from its time value, and asks an object of a class below for its own members. The same for the other built-in classes.
const say = (name, run) => {
  let said;
  try {
    said = String(run());
  } catch (error) {
    said = "throws " + error.name;
  }
  console.log(name + ": " + said);
};

class Stamp extends Date {}
class Later extends Stamp {
  getTime() {
    return 7;
  }
}
class Named extends Date {
  toJSON() {
    return "named " + super.getTime();
  }
}
class Spelled extends Date {
  toISOString() {
    return "spelled " + super.getTime();
  }
  valueOf() {
    return 9;
  }
}
function writeDates(dates) {
  return JSON.stringify(dates);
}
function sumOfTimes(dates) {
  let sum = 0;
  for (const date of dates) sum += date.getTime();
  return sum;
}
function describeDates(dates) {
  return dates
    .map(date =>
      [
        date.constructor.name,
        date instanceof Date,
        date instanceof Stamp,
        Object.getPrototypeOf(date) === Date.prototype,
        Object.prototype.toString.call(date),
        date.getTime(),
        +date,
        date.toISOString(),
        date.toJSON(),
      ].join(" "),
    )
    .join("\n  ");
}
const dates = step => [
  new Date(step),
  new Stamp(step + 1),
  new Later(step + 2),
  new Named(step + 3),
  new Spelled(step + 4),
  Reflect.construct(Date, [step + 5], Stamp),
  Reflect.construct(Stamp, [step + 6], Date),
  new Date(NaN),
  new Stamp(NaN),
];
for (let step = 0; step < 3; step++) {
  say("dates as text " + step, () => writeDates(dates(step * 86_400_000)));
  say("only dates " + step, () => writeDates([new Date(step), new Date(step + 1)]));
  say("sum of times " + step, () => sumOfTimes(dates(step).slice(0, 7)));
}
say("dates", () => describeDates(dates(1000).slice(0, 7)));

class Counted extends Map {
  get size() {
    return -1;
  }
  get(key) {
    return "counted " + super.get(key);
  }
}
function describeMaps(maps) {
  return maps.map(map => [map.constructor.name, map.size, map.get("a"), map.has("a"), map instanceof Counted, [...map.keys()].length].join(" ")).join(", ");
}
say("maps", () => describeMaps([new Map([["a", 1]]), new Counted([["a", 2]]), new (class extends Map {})([["a", 3]])]));

class Open extends Set {
  has() {
    return "open";
  }
  add(value) {
    return super.add(value + 1);
  }
}
function describeSets(sets) {
  return sets.map(set => [set.constructor.name, set.size, set.has(1), set.add(5).size, [...set].join("+")].join(" ")).join(", ");
}
say("sets", () => describeSets([new Set([1]), new Open([1]), new (class Plain extends Set {})([1])]));

class Failure extends Error {}
class Quiet extends Error {
  get message() {
    return "quiet";
  }
  toString() {
    return "a quiet failure";
  }
}
function isFailure(failure) {
  return Error.isError(failure);
}
function describeErrors(errors) {
  return errors.map(error => [error.constructor.name, error.name, error.message, String(error), isFailure(error), error instanceof Failure, Object.keys(error).length].join(" ")).join(", ");
}
say("errors", () => describeErrors([new Error("plain"), new Failure("failed"), new Quiet("loud"), new (class extends TypeError {})("typed")]));

class Stack extends Array {
  push(value) {
    return super.push(value * 2);
  }
  at() {
    return "top";
  }
}
function describeLists(lists) {
  return lists
    .map(list => [list.constructor.name, list.length, list.push(4), list.at(0), list.map(item => item + 1).constructor.name, Array.isArray(list), JSON.stringify(list), list.join("+")].join(" "))
    .join(", ");
}
say("lists", () => describeLists([[1, 2], Stack.of(1, 2), new Stack(2), new (class extends Array {})(1, 2)]));

class Loud extends RegExp {
  exec(text) {
    const found = super.exec(text);
    return found && Object.assign(found, { 0: found[0].toUpperCase() });
  }
  get flags() {
    return super.flags + "";
  }
}
function describePatterns(patterns) {
  return patterns.map(pattern => [pattern.constructor.name, pattern.source, pattern.flags, pattern.test("xay"), "xay".replace(pattern, "[$&]"), String("xay".match(pattern))].join(" ")).join(", ");
}
say("patterns", () => describePatterns([/a/, new RegExp("a"), new Loud("a"), new (class extends RegExp {})("a", "g")]));

class Bytes extends Uint8Array {
  get length() {
    return -5;
  }
  at(index) {
    return "byte " + super.at(index);
  }
}
function describeBytes(views) {
  return views.map(view => [view.constructor.name, view.length, view.byteLength, view.at(1), view[1], view.subarray(1).constructor.name, Object.prototype.toString.call(view)].join(" ")).join(", ");
}
say("bytes", () => describeBytes([new Uint8Array([1, 2]), new Bytes([3, 4]), new (class extends Uint8Array {})([5, 6])]));

class Wrapped extends Number {
  valueOf() {
    return 40;
  }
}
say("wrappers", () => [new Number(1), new Wrapped(2), new (class extends String {})("text"), new (class extends Boolean {})(false)].map(value => value.constructor.name + " " + (value + 2) + " " + typeof value).join(", "));

class Bare extends Object {}
say("objects", () => [{}, new Bare(), new Bare({ given: 1 })].map(made => made.constructor.name + " " + JSON.stringify(made) + " " + (Object.getPrototypeOf(made) === Object.prototype)).join(", "));

const either = flag =>
  class Either extends (flag ? Date : Map) {
    which() {
      return Object.prototype.toString.call(this);
    }
  };
say("one of two parents", () => [new (either(true))(5), new (either(false))()].map(made => made.which() + " " + (made instanceof Date) + " " + JSON.stringify(made)).join(", "));

class Eager extends Promise {
  then(resolved, rejected) {
    console.log("then of Eager");
    return super.then(resolved, rejected);
  }
}
async function awaitAll(promises) {
  const answers = [];
  for (const promise of promises) answers.push(promise.constructor.name + " " + (await promise));
  return answers.join(", ");
}
awaitAll([Promise.resolve(1), Eager.resolve(2), new Eager(resolve => resolve(3)), new (class extends Promise {})(resolve => resolve(4))]).then(answers => console.log("promises: " + answers));
