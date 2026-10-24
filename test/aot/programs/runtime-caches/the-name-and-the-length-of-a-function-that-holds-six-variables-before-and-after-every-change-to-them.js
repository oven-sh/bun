// What `name` and `length` of a function that holds six variables answer, asked many times through one place, before and after everything a program can do to them.
const lines = [];
function nameOf(fn) { return fn.name; }
function lengthOf(fn) { return fn.length; }
function describe(label, fn) {
  const row = [];
  for (let turn = 0; turn < 3; turn++) row.push(JSON.stringify(nameOf(fn)), lengthOf(fn));
  row.push("name" in fn, Object.hasOwn(fn, "name"), Object.hasOwn(fn, "length"), JSON.stringify(Object.getOwnPropertyDescriptor(fn, "name")), JSON.stringify(Object.getOwnPropertyDescriptor(fn, "length")));
  row.push(Reflect.ownKeys(fn).map(String).join("+"), Object.keys(fn).join("+"));
  lines.push(label + ": " + row.join(" "));
}
const key = "computed" + lines.length, symbol = Symbol("described"), bare = Symbol();
function makers(a, b, c, d, e, f) {
  const sum = () => a + b + c + d + e + f;
  const inferred = function (x, y) { return sum() + a + b + c + d + e + f + x + y; };
  const arrow = (x) => a + b + c + d + e + f + x;
  const holder = {
    method(x, y, z) { return a + b + c + d + e + f; },
    get got() { return a + b + c + d + e + f; },
    set got(v) { a = b + c + d + e + f + v; },
    [key](x) { return a + b + c + d + e + f; },
    [symbol]() { return a + b + c + d + e + f; },
    [bare]() { return a + b + c + d + e + f; },
    [key + "value"]: function () { return a + b + c + d + e + f; },
    property: function () { return a + b + c + d + e + f; },
    async later(x) { return a + b + c + d + e + f; },
    *each(x, y) { yield a + b + c + d + e + f; },
    async *eachLater() { yield a + b + c + d + e + f; },
  };
  const accessor = Object.getOwnPropertyDescriptor(holder, "got");
  return {
    declared: function declared(x, y = 1, z) { return a + b + c + d + e + f + x; },
    rest: function rest(x, ...others) { return a + b + c + d + e + f; },
    anonymous: (function () { return function () { return a + b + c + d + e + f; }; })(),
    inferred, arrow, method: holder.method, getter: accessor.get, setter: accessor.set, computed: holder[key], bySymbol: holder[symbol], byBareSymbol: holder[bare],
    computedValue: holder[key + "value"], property: holder.property, later: holder.later, each: holder.each, eachLater: holder.eachLater,
    constructs: function Constructs(x) { this.x = a + b + c + d + e + f + x; },
    classWithName: class { static name = "static " + (a + b + c + d + e + f); m() { return a + b + c + d + e + f; } },
    classWithNameMethod: class Named { static name() { return a + b + c + d + e + f; } },
    classPlain: class Plain { constructor(x, y) { this.x = a + b + c + d + e + f; } },
    classAnonymous: class { m() { return a + b + c + d + e + f; } },
    classWithLength: class L { static length = a + b + c + d + e + f; },
    bound: function target(x, y, z) { return a + b + c + d + e + f; }.bind(null, 1),
  };
}
const isNamedWhenEvaluated = new Set(["computed", "bySymbol", "byBareSymbol", "computedValue"]);
const changes = {
  nothing(fn) {},
  assign(fn) { fn.name = "assigned"; fn.length = 99; },
  assignStrict(fn) { "use strict"; try { fn.name = "assigned"; } catch (error) { lines.push("  " + error.constructor.name); } },
  define(fn) { Object.defineProperty(fn, "name", { value: "defined" }); Object.defineProperty(fn, "length", { value: 7 }); },
  defineGetter(fn) { Object.defineProperty(fn, "name", { get() { return "got"; } }); },
  restate(fn) { Object.defineProperty(fn, "name", { value: fn.name }); },
  remove(fn) { delete fn.name; },
  removeLength(fn) { delete fn.length; },
  removeBoth(fn) { delete fn.length; delete fn.name; },
  removeThenAssign(fn) { delete fn.name; fn.name = "again"; },
  otherProperty(fn) { fn.other = 1; },
  prototypeFirst(fn) { void fn.prototype; },
  freeze(fn) { Object.freeze(fn); },
  seal(fn) { Object.seal(fn); },
  noExtensions(fn) { Object.preventExtensions(fn); },
  parent(fn) { Object.setPrototypeOf(fn, { name: "inherited", length: -1 }); },
  parentAndRemove(fn) { Object.setPrototypeOf(fn, { name: "inherited", length: -1 }); delete fn.name; delete fn.length; },
  noParent(fn) { Object.setPrototypeOf(fn, null); },
  keysFirst(fn) { Reflect.ownKeys(fn); },
  bindIt(fn, kind) { if (!isNamedWhenEvaluated.has(kind)) try { describe("  bound of it", fn.bind(null, 1)); } catch (error) { lines.push("  " + error.constructor.name); } },
  text(fn) { void String(fn); },
};
for (const change of Object.keys(changes)) {
  const made = makers(1, 2, 3, 4, 5, 6);
  for (const kind of Object.keys(made)) {
    const fn = made[kind];
    describe(change + " " + kind + " before", makers(1, 2, 3, 4, 5, 6)[kind]);
    try { changes[change](fn, kind); } catch (error) { lines.push("  " + change + " " + kind + " " + error.constructor.name); }
    describe(change + " " + kind, fn);
    describe(change + " " + kind + " another", makers(1, 2, 3, 4, 5, 6)[kind]);
  }
}
console.log(lines.join("\n"));
