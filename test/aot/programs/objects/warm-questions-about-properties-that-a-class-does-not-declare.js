// Objects of classes and literals get properties that their layouts do not have, some of which hide what stands above them. They are read, called, asked for with `in` and with hasOwnProperty, warm,
// while the objects and their classes change step by step.
const unknown = JSON.parse('""');
class Base {
  constructor() { this.first = 1; this.second = "two"; }
  method() { return "Base.method"; }
  hidden() { return "Base.hidden"; }
  get accessor() { return "Base.accessor"; }
}
class Derived extends Base {
  constructor() { super(); this.third = 3; }
  method() { return "Derived.method"; }
  own() { return "Derived.own"; }
}
const makers = {
  base: () => new Base(),
  derived: () => new Derived(),
  literal: () => ({ first: 1, second: "two", method() { return "literal.method"; } }),
};
function extend(object, kind) {
  // No store in the program names them, so no layout has a place for them.
  object["extra" + unknown] = kind + ".extra";
  object["hidden" + unknown] = () => kind + ".hidden of its own";
  object["toString" + unknown] = () => kind + ".toString of its own";
  object["late" + unknown] = undefined;
  return object;
}
const names = ["first", "second", "third", "extra", "hidden", "toString", "late", "method", "own", "accessor", "valueOf", "missing", "added", "constructor"];
function describe(value) {
  if (typeof value === "function") {
    try { return "function:" + String(value.call({})).slice(0, 40); } catch (error) { return "function that throws " + error.constructor.name; }
  }
  return typeof value + ":" + String(value);
}
function readFirst(o) { return o.first; }
function readThird(o) { return o.third; }
function readExtra(o) { return o.extra; }
function readHidden(o) { return o.hidden; }
function readToString(o) { return o.toString; }
function readLate(o) { return o.late; }
function readMethod(o) { return o.method; }
function readOwn(o) { return o.own; }
function readAccessor(o) { return o.accessor; }
function readValueOf(o) { return o.valueOf; }
function readMissing(o) { return o.missing; }
function readAdded(o) { return o.added; }
function readConstructor(o) { return o.constructor === undefined ? "none" : o.constructor.name; }
const readers = [readFirst, readThird, readExtra, readHidden, readToString, readLate, readMethod, readOwn, readAccessor, readValueOf, readMissing, readAdded, readConstructor];
function callHidden(o) { return o.hidden(); }
function callMethod(o) { return o.method(); }
function callToString(o) { return o.toString(); }
function callAdded(o) { return o.added(); }
const callers = [callHidden, callMethod, callToString, callAdded];
function hasOwnExtra(o) { return o.hasOwnProperty("extra"); }
function hasOwnHidden(o) { return Object.hasOwn(o, "hidden"); }
function hasOwnLate(o) { return Object.hasOwn(o, "late"); }
function hasOwnFirst(o) { return Object.hasOwn(o, "first"); }
function hasOwnMethod(o) { return Object.hasOwn(o, "method"); }
function hasOwnToString(o) { return Object.prototype.hasOwnProperty.call(o, "toString"); }
function hasOwnValueOf(o) { return Object.hasOwn(o, "valueOf"); }
function hasOwnMissing(o) { return Object.hasOwn(o, "missing"); }
function hasOwnAdded(o) { return Object.hasOwn(o, "added"); }
function inExtra(o) { return "extra" in o; }
function inHidden(o) { return "hidden" in o; }
function inLate(o) { return "late" in o; }
function inMethod(o) { return "method" in o; }
function inValueOf(o) { return "valueOf" in o; }
function inMissing(o) { return "missing" in o; }
function inAdded(o) { return "added" in o; }
const askers = [hasOwnExtra, hasOwnHidden, hasOwnLate, hasOwnFirst, hasOwnMethod, hasOwnToString, hasOwnValueOf, hasOwnMissing, hasOwnAdded, inExtra, inHidden, inLate, inMethod, inValueOf, inMissing, inAdded];
function ask(object) {
  const line = [];
  for (const read of readers) {
    let value;
    for (let i = 0; i < 40; i++) value = read(object);
    line.push(describe(value));
  }
  for (const call of callers) {
    let value;
    for (let i = 0; i < 40; i++) {
      try { value = call(object); } catch (error) { value = "throws " + error.constructor.name; }
    }
    line.push(String(value));
  }
  let bits = "";
  for (const asker of askers) {
    let value;
    for (let i = 0; i < 40; i++) {
      try { value = asker(object); } catch { value = "x"; }
    }
    bits += value === "x" ? "x" : value ? "1" : "0";
  }
  line.push(bits);
  line.push(Object.keys(object).join(","));
  return line.join(" | ");
}
const objects = {};
for (const kind of Object.keys(makers)) {
  objects[kind + " as made"] = makers[kind]();
  objects[kind + " extended"] = extend(makers[kind](), kind);
  objects[kind + " extended twice"] = extend(makers[kind](), kind);
  objects[kind + " extended twice"]["more" + unknown] = 1;
}
function report(step) {
  console.log("== " + step);
  for (const name of Object.keys(objects)) console.log(name + ": " + ask(objects[name]));
}
const steps = [
  ["nothing has changed", () => {}],
  ["the same once more", () => {}],
  ["an extra property is written", () => { for (const name in objects) if (name.includes("extended")) objects[name]["extra" + unknown] = "written"; }],
  ["a class gets a method", () => { Base.prototype.added = function () { return "Base.added"; }; }],
  ["an object gets that name itself", () => { objects["derived extended"]["added" + unknown] = () => "added of its own"; }],
  ["the base class gets a name that was missing", () => { Base.prototype.missing = "no more"; }],
  ["an object hides it", () => { objects["literal extended"]["missing" + unknown] = "the literal's"; objects["base extended"]["missing" + unknown] = undefined; }],
  ["the base class loses it", () => { delete Base.prototype.missing; }],
  ["an extra property goes", () => { for (const name in objects) if (name.includes("twice")) delete objects[name]["hidden" + unknown]; }],
  ["an extra property becomes an accessor", () => { for (const name in objects) if (name.endsWith("extended")) Object.defineProperty(objects[name], "extra" + unknown, { get() { return "got"; }, configurable: true, enumerable: false }); }],
  ["a field goes", () => { for (const name in objects) if (name.includes("twice")) delete objects[name].first; }],
  ["the field comes back", () => { for (const name in objects) if (name.includes("twice")) objects[name].first = "back"; }],
  ["a method of the derived class goes", () => { delete Derived.prototype.method; }],
  ["the accessor of the base class is replaced", () => { Object.defineProperty(Base.prototype, "accessor", { value: "a value now", configurable: true, writable: true }); }],
  ["an object gets another prototype", () => { Object.setPrototypeOf(objects["derived extended"], { method() { return "stranger.method"; }, valueOf: 7 }); }],
  ["the derived class gets another base", () => { Object.setPrototypeOf(Derived.prototype, { hidden() { return "other.hidden"; }, added: () => "other.added" }); }],
  ["an object loses its prototype", () => { Object.setPrototypeOf(objects["base extended twice"], null); Object.setPrototypeOf(objects["literal extended"], null); }],
  ["objects are frozen", () => { Object.freeze(objects["base extended"]); Object.freeze(objects["literal extended twice"]); }],
  ["new objects of the same kinds", () => { for (const kind of Object.keys(makers)) objects[kind + " made late"] = extend(makers[kind](), kind); }],
];
for (const [step, change] of steps) {
  change();
  report(step);
}
