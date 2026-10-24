function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

class Stack {
  constructor() {
    this.length = 0;
    this.limit = 8;
  }
  grow() {
    this.length = this.length + 1;
    return this.length;
  }
  report() {
    return [this.length, this.length + 1, this.length & 7, this.length < this.limit, typeof this.length, Object.keys(this)];
  }
}

function Queue() {
  this.length = 0;
  this.limit = 8;
}
Queue.prototype.grow = Stack.prototype.grow;
Queue.prototype.report = Stack.prototype.report;

function makeList() {
  return { length: 0, limit: 8, grow: Stack.prototype.grow, report: Stack.prototype.report };
}

const writers = {
  "push.call": holder => Array.prototype.push.call(holder, "a", "b"),
  "push.call at the largest int32": holder => {
    for (let i = 0; i < 3; i++) holder.grow();
    Reflect.set(holder, "length", 2147483647);
    return Array.prototype.push.call(holder, "a");
  },
  "pop.call": holder => Array.prototype.pop.call(holder),
  "unshift.call": holder => Array.prototype.unshift.call(holder, "a"),
  "splice.call": holder => Array.prototype.splice.call(holder, 0, 0, "a", "b", "c").length,
  "fill.call after push.call": holder => {
    Array.prototype.push.call(holder, 1, 2);
    return Array.prototype.fill.call(holder, "x") === holder;
  },
  "Object.assign from parsed text": holder => Object.assign(holder, JSON.parse('{"length":"3"}')) === holder,
  "Object.assign of a fraction": holder => Object.assign(holder, JSON.parse('{"length":2.5}')) === holder,
  "Object.defineProperties": holder => Object.defineProperties(holder, JSON.parse('{"length":{"value":"4"}}')) === holder,
  "__defineGetter__": holder => holder.__defineGetter__("length", () => 5.5),
  "__defineSetter__": holder => holder.__defineSetter__("length", () => {}),
  "Reflect.deleteProperty": holder => Reflect.deleteProperty(holder, "length"),
  "Reflect.defineProperty": holder => Reflect.defineProperty(holder, "length", { value: null }),
  "Object.freeze": holder => Object.isFrozen(Object.freeze(holder)),
  "Object.seal": holder => Object.isSealed(Object.seal(holder)),
  "Object.preventExtensions and a deletion": holder => {
    Object.preventExtensions(holder);
    return delete holder.length;
  },
  "a reviver that changes its holder": holder =>
    JSON.parse('{"a":1}', function () {
      holder.limit = holder.limit;
      Reflect.set(holder, "length", "6");
      return 0;
    }),
  "a sort comparator that changes it": holder =>
    [2, 1].sort((a, b) => {
      Reflect.set(holder, "length", 7.5);
      return a - b;
    }),
  "Object.setPrototypeOf to an object with a setter": holder => {
    Reflect.deleteProperty(holder, "length");
    Object.setPrototypeOf(holder, {
      grow: Stack.prototype.grow,
      report: Stack.prototype.report,
      get length() {
        return 40;
      },
      set length(value) {},
    });
    return "length" in holder;
  },
};

const makers = { class: () => new Stack(), "constructor function": () => new Queue(), "object literal": makeList };
for (const kind of Object.keys(makers)) {
  for (let i = 0; i < 2000; i++) {
    const holder = makers[kind]();
    holder.grow();
    holder.report();
  }
  for (const name of Object.keys(writers)) {
    const holder = makers[kind]();
    holder.grow();
    attempt(kind + ": " + name, () => writers[name](holder));
    attempt(kind + ": " + name + ": report", () => holder.report());
    attempt(kind + ": " + name + ": grow", () => [holder.grow(), holder.report()]);
  }
}
attempt("Array.from.call(Stack)", () => Array.from.call(Stack, ["a", "b"]).report());
attempt("Array.of.call(Queue)", () => Array.of.call(Queue, "a", "b", "c").report());
attempt("Array.from.call(Stack) of an array-like with a text length", () => Array.from.call(Stack, { length: "2", 0: "a" }).report());
