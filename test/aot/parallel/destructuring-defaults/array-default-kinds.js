// Array patterns over an iterator that logs every step, with a default of every kind: literals, functions, locals, `this`, containers and built-in constants, and defaults that run code, which keep their place between the steps.
const log = [];
const note = (text) => {
  log.push(text);
  return text;
};

function steps(values, onNext = () => {}) {
  let index = 0;
  return {
    [Symbol.iterator]() {
      note("open");
      return this;
    },
    next() {
      note("next " + index);
      onNext();
      return index < values.length ? { value: values[index++], done: false } : { value: undefined, done: true };
    },
    return() {
      note("return");
      return {};
    },
  };
}

function show(value) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

function run(label, body) {
  let result;
  try {
    result = body().map(show).join(" ");
  } catch (error) {
    result = "threw " + error.name;
  }
  console.log(label + ": " + result + " | " + log.join(", "));
  log.length = 0;
}

function literals(x) {
  const [a = 1, b = "two", c = null, d = true, e = 5n] = x;
  return [a, b, c, d, e];
}

function functions(x) {
  const [arrow = () => 1, plain = function () {}, named = function inner() {}] = x;
  return [arrow, plain, named];
}

function locals(x, fallback) {
  const [a = fallback, b = a] = x;
  return [a, b];
}

function assigned(x, fallback) {
  let a = "old a";
  let b = "old b";
  [a = b, b = a, a = fallback] = x;
  return [a, b];
}

function containers(x, fallback) {
  const [list = [fallback, 1, , 2], record = { fallback: fallback, nested: { list: [] } }] = x;
  return [list, record];
}

function receiver(x) {
  const [self = this] = x;
  return [self === this];
}

function operators(x, fallback) {
  const [a = !fallback, b = typeof fallback, c = void 0, d = -1] = x;
  return [a, b, c, d];
}

function constants(x) {
  const [a = undefined, b = NaN, c = Infinity, d = Math.PI, e = Math.floor] = x;
  return [a, b, c, d, e];
}

function calls(x) {
  const [a = note("default a"), b = note("default b")] = x;
  return [a, b];
}

const source = {
  get first() {
    return note("get first");
  },
  get second() {
    return note("get second");
  },
};
function getters(x) {
  const [a = source.first, b = source.second] = x;
  return [a, b];
}

const convertible = {
  toString() {
    return note("toString");
  },
  valueOf() {
    note("valueOf");
    return 7;
  },
  *[Symbol.iterator]() {
    note("spread");
    yield 1;
  },
  get own() {
    return note("get own");
  },
};
function conversions(x) {
  const [a = `${convertible}`, b = -convertible, c = [...convertible], d = { ...convertible }] = x;
  return [a, b, c, Object.keys(d)];
}

function classes(x) {
  const [anonymous = class {}, named = class Inner {}, computed = class { [note("class key")]() {} }] = x;
  return [anonymous, named, computed];
}

function throwing(x) {
  const [a, b = note("default b"), c = (() => { throw new RangeError("default c"); })(), d = note("default d")] = x;
  return [a, b, c, d];
}

function deadZone(x) {
  const [a = b, b] = x;
  return [a, b];
}

function captured(values) {
  let count = 0;
  const [a = count, b = count, c = count] = steps(values, () => count++);
  return [a, b, c];
}

let shared = 0;
function moduleVariable(values) {
  shared = 0;
  const [a = shared, b = shared, c = shared] = steps(values, () => shared++);
  return [a, b, c];
}

globalThis.sharedGlobal = 0;
function globalVariable(values) {
  globalThis.sharedGlobal = 0;
  const [a = sharedGlobal, b = sharedGlobal, c = sharedGlobal] = steps(values, () => globalThis.sharedGlobal++);
  return [a, b, c];
}

class Base {
  constructor(x) {
    const [self = this] = x;
    this.same = self === this;
  }
}

class Derived extends Base {
  constructor(x) {
    try {
      const [self = this] = x;
      note("read " + typeof self);
    } catch (error) {
      note(error.name);
    }
    super(steps([]));
  }
}

for (const values of [[], [undefined, undefined, undefined, undefined], [0, null], ["v", "w", "x", "y", "z", "more"]]) {
  console.log("-- " + show(values.map(String)));
  run("literals", () => literals(steps(values)));
  run("functions", () => functions(steps(values)));
  run("locals", () => locals(steps(values), "fallback"));
  run("assigned", () => assigned(steps(values), "fallback"));
  run("containers", () => containers(steps(values), "fallback"));
  run("receiver", () => receiver.call({}, steps(values)));
  run("operators", () => operators(steps(values), "fallback"));
  run("constants", () => constants(steps(values)));
  run("calls", () => calls(steps(values)));
  run("getters", () => getters(steps(values)));
  run("conversions", () => conversions(steps(values)));
  run("classes", () => classes(steps(values)));
  run("throwing", () => throwing(steps(values)));
  run("dead zone", () => deadZone(steps(values)));
  run("captured", () => captured(values));
  run("module variable", () => moduleVariable(values));
  run("global variable", () => globalVariable(values));
  run("base constructor", () => [new Base(steps(values)).same]);
  run("derived constructor", () => [new Derived(steps(values)).same]);
}
/* Output:
-- []
literals: 1 two null true 5n | open, next 0
functions: function arrow function plain function inner | open, next 0
locals: fallback fallback | open, next 0
assigned: fallback old b | open, next 0
containers: ["fallback",1,null,2] {"fallback":"fallback","nested":{"list":[]}} | open, next 0
receiver: true | open, next 0
operators: false string undefined -1 | open, next 0
constants: undefined NaN Infinity 3.141592653589793 function floor | open, next 0
calls: default a default b | open, next 0, default a, default b
getters: get first get second | open, next 0, get first, get second
conversions: toString -7 [1] ["toString","valueOf","own"] | open, next 0, toString, valueOf, spread, get own
classes: function anonymous function Inner function computed | open, next 0, class key
throwing: threw RangeError | open, next 0, default b
dead zone: threw ReferenceError | open, next 0
captured: 1 1 1 | open, next 0
module variable: 1 1 1 | open, next 0
global variable: 1 1 1 | open, next 0
base constructor: true | open, next 0
derived constructor: true | open, next 0, ReferenceError, open, next 0
-- ["undefined","undefined","undefined","undefined"]
literals: 1 two null true 5n | open, next 0, next 1, next 2, next 3, next 4
functions: function arrow function plain function inner | open, next 0, next 1, next 2, return
locals: fallback fallback | open, next 0, next 1, return
assigned: fallback old b | open, next 0, next 1, next 2, return
containers: ["fallback",1,null,2] {"fallback":"fallback","nested":{"list":[]}} | open, next 0, next 1, return
receiver: true | open, next 0, return
operators: false string undefined -1 | open, next 0, next 1, next 2, next 3, return
constants: undefined NaN Infinity 3.141592653589793 function floor | open, next 0, next 1, next 2, next 3, next 4
calls: default a default b | open, next 0, default a, next 1, default b, return
getters: get first get second | open, next 0, get first, next 1, get second, return
conversions: toString -7 [1] ["toString","valueOf","own"] | open, next 0, toString, next 1, valueOf, next 2, spread, next 3, get own, return
classes: function anonymous function Inner function computed | open, next 0, next 1, next 2, class key, return
throwing: threw RangeError | open, next 0, next 1, default b, next 2, return
dead zone: threw ReferenceError | open, next 0, return
captured: 1 2 3 | open, next 0, next 1, next 2, return
module variable: 1 2 3 | open, next 0, next 1, next 2, return
global variable: 1 2 3 | open, next 0, next 1, next 2, return
base constructor: true | open, next 0, return
derived constructor: true | open, next 0, return, ReferenceError, open, next 0
-- ["0","null"]
literals: 0 null null true 5n | open, next 0, next 1, next 2
functions: 0 null function inner | open, next 0, next 1, next 2
locals: 0 null | open, next 0, next 1, return
assigned: fallback null | open, next 0, next 1, next 2
containers: 0 null | open, next 0, next 1, return
receiver: false | open, next 0, return
operators: 0 null undefined -1 | open, next 0, next 1, next 2
constants: 0 null Infinity 3.141592653589793 function floor | open, next 0, next 1, next 2
calls: 0 null | open, next 0, next 1, return
getters: 0 null | open, next 0, next 1, return
conversions: 0 null [1] ["toString","valueOf","own"] | open, next 0, next 1, next 2, spread, get own
classes: 0 null function computed | open, next 0, next 1, next 2, class key
throwing: threw RangeError | open, next 0, next 1, next 2
dead zone: 0 null | open, next 0, next 1, return
captured: 0 null 3 | open, next 0, next 1, next 2
module variable: 0 null 3 | open, next 0, next 1, next 2
global variable: 0 null 3 | open, next 0, next 1, next 2
base constructor: false | open, next 0, return
derived constructor: true | open, next 0, return, read number, open, next 0
-- ["v","w","x","y","z","more"]
literals: v w x y z | open, next 0, next 1, next 2, next 3, next 4, return
functions: v w x | open, next 0, next 1, next 2, return
locals: v w | open, next 0, next 1, return
assigned: x w | open, next 0, next 1, next 2, return
containers: v w | open, next 0, next 1, return
receiver: false | open, next 0, return
operators: v w x y | open, next 0, next 1, next 2, next 3, return
constants: v w x y z | open, next 0, next 1, next 2, next 3, next 4, return
calls: v w | open, next 0, next 1, return
getters: v w | open, next 0, next 1, return
conversions: v w x ["0"] | open, next 0, next 1, next 2, next 3, return
classes: v w x | open, next 0, next 1, next 2, return
throwing: v w x y | open, next 0, next 1, next 2, next 3, return
dead zone: v w | open, next 0, next 1, return
captured: v w x | open, next 0, next 1, next 2, return
module variable: v w x | open, next 0, next 1, next 2, return
global variable: v w x | open, next 0, next 1, next 2, return
base constructor: false | open, next 0, return
derived constructor: true | open, next 0, return, read string, open, next 0
*/
