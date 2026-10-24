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

class Registry {
  static count = 0;
  static #hidden = 0;
  static register() {
    Registry.#hidden++;
    return ++Registry.count;
  }
  static bucket() {
    return Registry.count & 7;
  }
  static doubled() {
    return this.count * 2;
  }
  static plusOne() {
    return Registry.count + 1;
  }
  static hidden() {
    return [Registry.#hidden, Registry.#hidden & 7, Registry.#hidden + 1];
  }
  static setHidden(value) {
    Registry.#hidden = value;
  }
}

class Derived extends Registry {}

const late = [0.5, NaN, 2147483647, 2147483648, -0, "3", undefined, null, true, 3n, [4], { valueOf: () => 5 }, Symbol("s")];
for (let i = 0; i < 2000; i++) {
  Registry.register();
  Registry.bucket();
  Registry.doubled();
  Registry.plusOne();
  Registry.hidden();
}
console.log("after 2000 honest rounds", Registry.count, show(Registry.hidden()));

for (const value of late) {
  const label = "count = " + show(value);
  Registry.count = value;
  Registry.setHidden(value);
  attempt(label + " bucket", () => Registry.bucket());
  attempt(label + " doubled", () => Registry.doubled());
  attempt(label + " plusOne", () => Registry.plusOne());
  attempt(label + " hidden", () => Registry.hidden());
  attempt(label + " register", () => [Registry.register(), Registry.count, Registry.hidden()]);
}

Registry.count = 1;
attempt("read through the subclass", () => [Derived.count, Derived.doubled(), Derived.plusOne()]);
Derived.count = "own";
attempt("the subclass has its own", () => [Derived.count, Derived.doubled(), Derived.plusOne(), Registry.count]);
delete Registry.count;
attempt("deleted", () => [Registry.count, Registry.bucket(), Registry.doubled(), Registry.plusOne(), Registry.register()]);
Object.defineProperty(Registry, "count", { get: () => 2.5, set() {}, configurable: true });
attempt("an accessor", () => [Registry.count, Registry.bucket(), Registry.doubled(), Registry.plusOne(), Registry.register(), Registry.count]);
