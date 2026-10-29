// A class evaluated again whose definition creates members.
const EventEmitter = require("node:events");
const hidden = Symbol("hidden");
const lines = [];

function define(step, name) {
  class Made extends EventEmitter {
    stored = "nothing";
    shadowed = "field";
    first() {
      return "first" + step;
    }
    [hidden]() {
      return "hidden" + step;
    }
    second() {
      return "second" + step;
    }
    shadowed() {
      return "method" + step;
    }
    get both() {
      return "got" + step;
    }
    set both(value) {
      this.stored = value + step;
    }
    [name]() {
      return name + step;
    }
    get onlyRead() {
      return "read" + step;
    }
    *[Symbol.iterator]() {
      yield step;
      yield step + 1;
    }
    second() {
      return "second again" + step;
    }
    static [name]() {
      return "static " + name + step;
    }
    static last() {
      return "static last" + step;
    }
    10() {
      return "ten" + step;
    }
  }
  return Made;
}

function show(Made, name) {
  const made = new Made();
  made.both = "set";
  lines.push(
    [made.first(), made[hidden](), made.second(), made.both, made.stored, made[name](), made.onlyRead, [...made].join(), Made[name](), Made.last(), made[10]()].join(" | "),
  );
  lines.push([made.shadowed, Made.prototype.shadowed.call(made), Object.keys(made).join()].join(" | "));
  lines.push(Reflect.ownKeys(Made.prototype).map(String).join());
  lines.push(Reflect.ownKeys(Made).map(String).join());
  const descriptor = Object.getOwnPropertyDescriptor(Made.prototype, "both");
  lines.push([typeof descriptor.get, typeof descriptor.set, descriptor.enumerable, descriptor.configurable].join());
  const method = Object.getOwnPropertyDescriptor(Made.prototype, "second");
  lines.push([typeof method.value, method.writable, method.enumerable, method.configurable].join());
}

const One = define(1, "computed");
show(One, "computed");
const Two = define(2, "first");
show(Two, "first");
show(One, "computed");

One.prototype.second = function () {
  return "replaced";
};
One.prototype.added = function () {
  return "added";
};
delete One.prototype.first;
const Three = define(3, "computed");
show(Three, "computed");
lines.push([new One().second(), new One().added(), typeof new One().first, typeof new Three().added, new Two().second()].join(" | "));
lines.push(String(One.prototype === Three.prototype), String(Object.getPrototypeOf(One.prototype) === EventEmitter.prototype));

let sum = 0;
for (let round = 0; round < 300; round++) {
  const Made = define(round, round & 1 ? "odd" : "even");
  const made = new Made();
  sum += made.second().length + made[round & 1 ? "odd" : "even"]().length + [...made].length;
}
lines.push(String(sum));

function throwing() {
  try {
    class Broken extends EventEmitter {
      before() {}
      [(() => {
        throw new Error("no key");
      })()]() {}
      after() {}
    }
    return Broken;
  } catch (error) {
    return error.message;
  }
}
lines.push(throwing(), throwing());
console.log(lines.join("\n"));
