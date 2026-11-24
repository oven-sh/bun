// Constructors that store on their object under the names of a list that the file writes.
const printed = [];
const print = (...values) => printed.push(values.map(String).join(" "));
const attempt = f => {
  try {
    return f();
  } catch (error) {
    return error.constructor.name;
  }
};
const LEVELS = ["debug", "info", "warn"];
class Logger {
  constructor() {
    this.count = 0;
    for (const level of LEVELS) this[level] = text => this.log(level, text);
  }
  log(level, text) {
    this.count += level.length + text.length;
    return this.count;
  }
}
const logger = new Logger();
let n = LEVELS.indexOf("warn");
for (let k = 0; k < 40; k++) n ^= logger.info("a") + logger.warn("bb");
print(n, logger.count, Object.keys(logger), JSON.stringify(logger));
logger.info = 5;
delete logger.warn;
print(logger.info, logger.warn, Object.keys(logger));

const NAMES = ["count", "total", "method", "half", "last"];
class Counter {
  constructor(start) {
    this.count = start;
    for (const name of NAMES) {
      if (start === 7 && name === "half") throw new RangeError(name);
      this[name] = start + 1;
    }
    this.end = this.count;
  }
  method() {
    return "method";
  }
  get half() {
    return this.kept;
  }
  set half(value) {
    this.kept = value / 2;
  }
}
function sum(counters, times) {
  let total = 0;
  for (let k = 0; k < times; k++) {
    const counter = counters[k % counters.length];
    total += counter.count + counter.total + counter.half + counter.last + counter.end;
    counter.total = k;
  }
  return total;
}
const counters = [new Counter(1), new Counter(2), new Counter(4)];
print(sum(counters, 30), counters[0].method, Object.keys(counters[1]), attempt(() => new Counter(7)));
Object.defineProperty(Counter.prototype, "last", { set: value => print("last", value), configurable: true });
const late = new Counter(9);
print(late.last, late.count, Object.keys(late));
Object.freeze(counters[0]);
print(
  attempt(() => sum(counters, 3)),
  counters[0].total,
);

class Sealed {
  constructor() {
    this.foo = 0;
    Object.preventExtensions(this);
    for (const name of ["foo", "bar"]) this[name] = 1;
  }
}
print(attempt(() => new Sealed()));
class Parent {
  constructor() {
    for (const name of LEVELS) this[name] = name.length;
  }
}
class Child extends Parent {
  set info(value) {
    print("info", value);
  }
}
const family = [new Parent(), new Child()];
print(family.map(one => Object.keys(one)), family[1].info, family[0].info);
console.log(printed.join("\n"));
