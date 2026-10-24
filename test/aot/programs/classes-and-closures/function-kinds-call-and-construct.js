// Functions of every kind are called, constructed with `new`, and constructed with Reflect.construct for another new.target.
class Other {}

const receiver = {};
const seen = [];
function note(target) {
  seen.push(target === undefined ? "undefined" : target === Other ? "Other" : target.name);
}

function plain() {
  note(new.target);
  return this === receiver ? "plain with the bound this" : "plain";
}
const arrow = () => "arrow";
const holder = {
  method() {
    note(new.target);
    return this === receiver ? "method with the bound this" : "method";
  },
  get getter() {
    note(new.target);
    return "getter";
  },
};
async function asyncFunction() { note(new.target); }
function* generator() { note(new.target); }
async function* asyncGenerator() { note(new.target); }
class Base {
  constructor() { note(new.target); }
}
class Derived extends Base {
  constructor() {
    note(new.target);
    super();
  }
}
const Anonymous = class {};
const Alias = class Named {};
function onlyCalled() { return new.target; }

const kinds = {
  "plain": plain,
  "arrow": arrow,
  "method": holder.method,
  "getter": Object.getOwnPropertyDescriptor(holder, "getter").get,
  "async function": asyncFunction,
  "generator": generator,
  "async generator": asyncGenerator,
  "base class": Base,
  "derived class": Derived,
  "bound plain": plain.bind(receiver),
  "bound method": holder.method.bind(receiver),
};

function describe(value) {
  if (typeof value !== "object" || value === null) return String(value);
  const tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Object") return "object of " + Object.getPrototypeOf(value).constructor.name;
  if (tag.endsWith("Generator")) value.next();
  return tag;
}

function attempt(label, run) {
  seen.length = 0;
  let outcome;
  try {
    outcome = describe(run());
  } catch (error) {
    // Plain Bun names the expression that is not a constructor, compiled code names the kind of value.
    outcome = error.constructor.name + ": " + error.message.replace(/^.* is not a constructor.*$/s, "not a constructor");
  }
  return label + ": " + outcome + (seen.length ? ", new.target " + seen.join(" then ") : "");
}

function attemptThroughValues() {
  const lines = [];
  for (const [kind, callee] of Object.entries(kinds)) {
    lines.push(attempt(kind + " called", () => callee()));
    lines.push(attempt(kind + " constructed", () => new callee()));
    lines.push(attempt(kind + " constructed for Other", () => Reflect.construct(callee, [], Other)));
  }
  return lines.join("\n");
}

const first = attemptThroughValues();
console.log(first);
for (let round = 0; round < 3; round++) console.log("same outcomes again:", attemptThroughValues() === first);

console.log(attempt("plain()", () => plain()));
console.log(attempt("new plain()", () => new plain()));
console.log(attempt("new arrow()", () => new arrow()));
console.log(attempt("new holder.method()", () => new holder.method()));
console.log(attempt("new asyncFunction()", () => new asyncFunction()));
console.log(attempt("new generator()", () => new generator()));
console.log(attempt("new asyncGenerator()", () => new asyncGenerator()));
console.log(attempt("Base()", () => Base()));
console.log(attempt("Derived()", () => Derived()));
console.log(attempt("Anonymous()", () => Anonymous()));
console.log(attempt("Alias()", () => Alias()));
console.log(attempt("new Base()", () => new Base()));
console.log(attempt("new Derived()", () => new Derived()));
console.log(attempt("Reflect.construct(Derived, [], Other)", () => Reflect.construct(Derived, [], Other)));
console.log(attempt("onlyCalled()", () => onlyCalled()));
