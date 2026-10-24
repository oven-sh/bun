const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

console.log("strict:", (function () { return this === undefined; })());

class Base {
  constructor() {
    this.early = this.describe();
  }
  describe() {
    return "base";
  }
}
class Derived extends Base {
  x = 1;
  y = 2;
  list = [5, 6];
  text = "abc";
  step = value => value + 1;
  describe() {
    const results = [];
    for (const use of [() => this.x + this.y, () => this.x | 0, () => this.list.push(1), () => this.text.charCodeAt(0), () => this.step(1), () => Object.keys(this)]) results.push(outcome(use));
    return results.join(" ; ");
  }
}
for (let i = 0; i < 1000; i++) new Derived().describe();
{
  const made = new Derived();
  console.log("in the base constructor -> " + made.early);
  console.log("afterwards -> " + made.describe());
}

function OldBase() {
  this.early = this.sum();
}
OldBase.prototype.sum = function () {
  return "base";
};
function OldDerived() {
  OldBase.call(this);
  this.x = 1;
  this.y = 2;
}
OldDerived.prototype = Object.create(OldBase.prototype);
OldDerived.prototype.sum = function () {
  return this.x + this.y;
};
attempt("a constructor function whose parent calls the method early", () => {
  const made = new OldDerived();
  return [made.early, made.sum()];
});

function readsAVariableDeclaredBelow() {
  const before = outcome(() => later + 1);
  var later = 7;
  return [before, later + 1];
}
function readsALetDeclaredBelow() {
  const read = () => later + 1;
  const before = outcome(read);
  let later = 7;
  return [before, read()];
}
function callsAFunctionThatReadsAConstDeclaredBelow() {
  const before = outcome(helper);
  const list = [5, 6];
  function helper() {
    list.push(1);
    return list.length;
  }
  return [before, helper()];
}
function readsAClassDeclaredBelow() {
  const make = () => new Later().x;
  const before = outcome(make);
  class Later {
    x = 1;
  }
  return [before, make()];
}
function usesAParameterDeclaredToTheRight(a = () => b + 1, b = 7) {
  return a();
}
function usesAParameterToTheRightAtOnce(a = b + 1, b = 7) {
  return a;
}
function loopsOverClosuresMadeBeforeTheAssignment() {
  const reads = [];
  let n;
  for (let i = 0; i < 3; i++) reads.push(() => n + i);
  const before = reads.map(read => read());
  n = 7;
  const between = reads.map(read => read());
  n = "7";
  return [before, between, reads.map(read => read())];
}
for (let i = 0; i < 1000; i++) {
  readsAVariableDeclaredBelow();
  readsALetDeclaredBelow();
  callsAFunctionThatReadsAConstDeclaredBelow();
  readsAClassDeclaredBelow();
  usesAParameterDeclaredToTheRight();
  loopsOverClosuresMadeBeforeTheAssignment();
}
attempt("a var declared below", readsAVariableDeclaredBelow);
attempt("a let declared below", readsALetDeclaredBelow);
attempt("a const declared below, read by a hoisted function", callsAFunctionThatReadsAConstDeclaredBelow);
attempt("a class declared below", readsAClassDeclaredBelow);
attempt("a parameter to the right, read later", () => usesAParameterDeclaredToTheRight());
attempt("a parameter to the right, read at once", () => usesAParameterToTheRightAtOnce());
attempt("a parameter to the right, given", () => usesAParameterToTheRightAtOnce(undefined, 1));
attempt("closures made before the assignment", loopsOverClosuresMadeBeforeTheAssignment);

class Counted {
  static first = Counted.second + 1;
  static second = 7;
  static third = Counted.second + 1;
}
attempt("a static field that reads the next one", () => [Counted.first, Counted.second, Counted.third]);
attempt("a static field that reads its own class by a name set later", () => {
  const Made = class {
    static own = outcome(() => Made.name);
  };
  return Made.own;
});
attempt("an object literal that reads itself", () => {
  var o = { x: 1, y: outcome(() => o.x + 1) };
  return o;
});
