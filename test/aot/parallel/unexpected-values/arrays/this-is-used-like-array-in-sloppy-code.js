// This is used like an array in sloppy code.
function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

function total() {
  let sum = 0;
  for (let i = 0; i < this.length; i++) sum += this[i];
  return sum;
}

function add(value) {
  return this.push(value);
}

function walk() {
  const seen = [];
  for (const value of this) seen.push(value);
  return seen;
}

function doubled() {
  return this.map(value => value * 2);
}

function lastOne() {
  return this[this.length - 1];
}

function clear() {
  this.length = 0;
  return this;
}

function copy() {
  return [...this];
}

function kind() {
  return [typeof this, Array.isArray(this)];
}

const methods = { total, add, walk, doubled, lastOne, clear, copy, kind };

class Stack extends Array {}
Object.assign(Stack.prototype, methods);

class Loud extends Array {
  push() {
    return "the subclass's push";
  }
  map() {
    return "the subclass's map";
  }
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}
Object.assign(Loud.prototype, methods);

const makers = {
  "an array": () => [3, 1, 2],
  "a subclass that has the methods": () => Stack.of(3, 1, 2),
  "a subclass that overrides": () => Loud.of(3, 1, 2),
  "an array-like": () => ({ 0: 3, 1: 1, 2: 2, length: 3 }),
  "an array-like with a push": () => ({ 0: 3, length: 1, push: Array.prototype.push }),
  "a string": () => "312",
  "a number": () => 312,
  "a typed array": () => new Uint8Array([3, 1, 2]),
  "a Set": () => new Set([3, 1, 2]),
  "arguments": () => (function () { return arguments; })(3, 1, 2),
  "a proxy": () => new Proxy([3, 1, 2], {}),
  "a frozen array": () => Object.freeze([3, 1, 2]),
  "a function": () => function (a, b) {},
  "null": () => null,
  "undefined": () => undefined,
};

const routes = {
  call: (method, receiver) => method.call(receiver, 9),
  apply: (method, receiver) => method.apply(receiver, [9]),
  bind: (method, receiver) => method.bind(receiver)(9),
  reflect: (method, receiver) => Reflect.apply(method, receiver, [9]),
};

for (const name in methods) for (let i = 0; i < 1000; i++) methods[name].call([3, 1, 2], 9);

for (const maker in makers) {
  for (const name in methods) {
    const answers = [];
    for (const route in routes) {
      try {
        answers.push(route + " " + describe(routes[route](methods[name], makers[maker]())));
      } catch (error) {
        answers.push(route + " threw " + error.constructor.name);
      }
    }
    console.log(maker + ", " + name + ": " + answers.join("; "));
  }
}

attempt("as a method of the subclass", () => { const stack = Stack.of(3, 1, 2); return [stack.total(), stack.add(9), stack.walk(), stack.doubled(), stack.lastOne(), stack.copy(), stack.kind(), stack.clear()]; });
attempt("as a method of the loud subclass", () => { const stack = Loud.of(3, 1, 2); return [stack.total(), stack.add(9), stack.walk(), stack.doubled(), stack.lastOne(), stack.copy(), stack.kind(), stack.clear()]; });
attempt("as a method of an object", () => { const holder = { ...methods, 0: 7, length: 1 }; return [holder.total(), holder.lastOne(), holder.kind()]; });
attempt("as an own method of an array", () => { const list = Object.assign([3, 1, 2], methods); return [list.total(), list.add(9), list.walk(), list.lastOne(), list.kind()]; });
attempt("called without a receiver", () => total());
attempt("called without a receiver, kind", () => kind());
attempt("taken off an array and called", () => { const list = Object.assign([3, 1, 2], methods); const taken = list.total; return taken(); });

module.exports = methods;
