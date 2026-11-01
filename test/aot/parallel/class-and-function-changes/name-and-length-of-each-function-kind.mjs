const opaque = value => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
const decoded = text => Buffer.from(text).toString(); // or a string decoded at run time
function show(value) {
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  return typeof value + " " + String(value);
}
function attempt(label, action) {
  let outcome;
  try {
    outcome = show(action());
  } catch (error) {
    outcome = error.name;
  }
  console.log(label + ": " + outcome);
}
function declared(a, b, c = 1, ...rest) {}
const arrow = a => a;
const assigned = function () {};
const named = function inner() {};
const anonymous = (() => function () {})();
const defaulted = (a = 1, b) => {};
const gathered = (...all) => {};
const destructured = ({ a }, [b], c) => {};
class Klass {
  constructor(a, b) {}
  static method(a) {}
  method() {}
  get value() {
    return 1;
  }
  set value(v) {}
  static #hidden() {}
  static hidden() {
    return Klass.#hidden;
  }
}
class Heir extends Klass {}
class WithName {
  static name = "custom";
}
class WithNameMethod {
  static name() {}
}
class WithLength {
  static length = 9;
}
const NamelessClass = (() => class {})();
const tag = Symbol("tag");
const object = {
  method() {},
  ["computed" + 1]() {},
  [tag]() {},
  [Symbol()]() {},
  get got() {
    return 1;
  },
  set got(v) {},
  arrow: () => {},
  plain: function () {},
  async later() {},
  *made() {},
  5() {},
};
async function later() {}
function* made() {}
async function* both() {}
const bound = declared.bind(null, 1);
const boundTwice = bound.bind(null);
const boundWithExtraArguments = arrow.bind(null, 1, 2, 3);
let late;
late = function () {};
const { pattern = function () {} } = {};
const elements = [function () {}];
const element = elements[0];
let filled;
filled ||= function () {};
const renamed = Object.defineProperty(function original() {}, "name", { value: "renamed" });
const functions = {
  declared,
  arrow,
  assigned,
  named,
  anonymous,
  defaulted,
  gathered,
  destructured,
  Klass,
  Heir,
  WithName,
  WithNameMethod,
  WithLength,
  NamelessClass,
  "Klass.method": Klass.method,
  "Klass.prototype.method": Klass.prototype.method,
  "Klass's getter": Object.getOwnPropertyDescriptor(Klass.prototype, "value").get,
  "Klass's setter": Object.getOwnPropertyDescriptor(Klass.prototype, "value").set,
  "a private method": Klass.hidden(),
  "object.method": object.method,
  "object.computed1": object.computed1,
  "object[tag]": object[tag],
  "object[Symbol()]": object[Object.getOwnPropertySymbols(object)[1]],
  "object's getter": Object.getOwnPropertyDescriptor(object, "got").get,
  "object's setter": Object.getOwnPropertyDescriptor(object, "got").set,
  "object.arrow": object.arrow,
  "object.plain": object.plain,
  "object.later": object.later,
  "object.made": object.made,
  "object[5]": object[5],
  later,
  made,
  both,
  bound,
  boundTwice,
  boundWithExtraArguments,
  late,
  pattern,
  element,
  filled,
  renamed,
  "bound renamed": renamed.bind(null),
  "bound class": Klass.bind(null, 1),
  "Math.max": Math.max,
  "bound Math.max": Math.max.bind(null),
};
function nameOf(callable) {
  return callable.name;
}
function lengthOf(callable) {
  return callable.length;
}
for (const [label, callable] of Object.entries(functions)) {
  attempt(label + ", name", () => nameOf(callable));
  attempt(label + ", length", () => lengthOf(callable));
  attempt(label + ", own names", () => Object.getOwnPropertyNames(callable).join());
  attempt(label + ", descriptors", () =>
    JSON.stringify([
      Object.getOwnPropertyDescriptor(callable, "name"),
      Object.getOwnPropertyDescriptor(callable, "length"),
    ]),
  );
}
function namesOfKnownFunctions() {
  return [
    declared.name,
    arrow.name,
    assigned.name,
    named.name,
    anonymous.name,
    Klass.name,
    Heir.name,
    WithName.name,
    typeof WithNameMethod.name,
    WithLength.name,
    NamelessClass.name,
    later.name,
    made.name,
    both.name,
    bound.name,
    boundTwice.name,
    late.name,
    renamed.name,
    Klass.method.name,
    object.method.name,
  ].join();
}
function lengthsOfKnownFunctions() {
  return [
    declared.length,
    arrow.length,
    defaulted.length,
    gathered.length,
    destructured.length,
    Klass.length,
    Heir.length,
    WithName.length,
    WithLength.length,
    later.length,
    bound.length,
    boundTwice.length,
    boundWithExtraArguments.length,
    Klass.method.length,
  ].join();
}
attempt("names of known functions", namesOfKnownFunctions);
attempt("names of known functions, again", namesOfKnownFunctions);
attempt("lengths of known functions", lengthsOfKnownFunctions);
attempt("lengths of known functions, again", lengthsOfKnownFunctions);
