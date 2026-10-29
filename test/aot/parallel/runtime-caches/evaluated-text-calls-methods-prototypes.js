// Text that is made at run time calls what it is given and reads methods from prototypes, at places that have run often: every kind of callee, one after another at one place,
// results of every kind, what is thrown through the call, and prototypes that change behind a warm place.
const lines = [];
function describe(value) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "bigint") return value + "n";
  if (Object.is(value, -0)) return "-0";
  if (value instanceof Promise) return "a promise";
  if (Array.isArray(value)) return "[" + value.map(describe).join(", ") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).map(key => key + ": " + describe(value[key])).join(", ") + "}";
  return String(value);
}
function show(label, f) {
  try {
    lines.push(label + ": " + describe(f()));
  } catch (error) {
    lines.push(label + ": throws " + (error && error.constructor ? error.constructor.name : describe(error)));
  }
}
function plain(a, b) { return [this === undefined ? "no this" : typeof this, a, b, arguments.length]; }
function strict(a, b) { "use strict"; return [this === undefined ? "no this" : typeof this, a, b, arguments.length]; }
const arrow = (a, b) => [a, b];
function withDefault(a = "default", ...rest) { return [a, rest]; }
async function asynchronous(a) { return a; }
function* generator(a) { yield a; }
class Class { constructor(a) { this.a = a; } static make(a) { return new this(a); } method(a) { return [this.a, a]; } }
function thrower(a) { throw new RangeError(String(a)); }
function throwsPrimitive(a) { throw a; }
const bound = plain.bind("bound this", "bound argument");
const proxy = new Proxy(plain, {});
const trapped = new Proxy(plain, { apply(target, self, list) { return ["trapped", list.length]; } });
const fromText = new Function("a", "b", "return [a, b, arguments.length]");
const callees = {
  plain, strict, arrow, withDefault, asynchronous, generator, Class, thrower, throwsPrimitive, bound, proxy, trapped, fromText,
  max: Math.max, isArray: Array.isArray, parseInt, String, Symbol, Object, Date: () => typeof Date(), hasOwn: Object.hasOwn, charCodeAt: String.prototype.charCodeAt,
  undefined: undefined, null: null, number: 1, object: {}, string: "text",
  returnsMinusZero: () => -0, returnsNaN: () => NaN, returnsDouble: () => 1.5, returnsBig: () => 2 ** 40, returnsBigInt: () => 10n, returnsSymbol: () => Symbol.iterator, returnsNothing: () => {},
  returnsHole: () => [, 1], returnsItself: function itself() { return itself; },
};
const callers = {
  none: new Function("f", "return f()"),
  one: new Function("f", "a", "return f(a)"),
  two: new Function("f", "a", "b", "return f(a, b)"),
  five: new Function("f", "a", "b", "return f(a, b, a, b, a)"),
  unused: new Function("f", "a", "f(a); return 'done'"),
  caught: new Function("f", "a", "try { return f(a) } catch (error) { return ['caught', typeof error] } finally { f = null }"),
  nested: new Function("f", "a", "return [f(a), f(f(a)), f(a)]"),
  strictCaller: new Function("f", "a", "'use strict'; return f(a)"),
  constant: new Function("f", "return f('constant', 1.5)"),
  inLoop: new Function("f", "a", "let last; for (let i = 0; i < 3; i++) last = f(a, i); return last"),
};
for (const warmWith of ["plain", "fromText", "max"]) {
  for (const [callerName, text] of Object.entries(callers)) {
    const caller = new Function("return " + text.toString())();
    for (let i = 0; i < 300; i++) caller(callees[warmWith], i, "second");
    for (const [name, callee] of Object.entries(callees)) show(`${warmWith} ${callerName} ${name}`, () => caller(callee, "first", "second"));
    show(`${warmWith} ${callerName} again`, () => caller(callees[warmWith], "first", "second"));
  }
}

// Text calls text, and compiled code between them.
const fibonacci = new Function("self", "n", "return n < 2 ? n : self(self, n - 1) + self(self, n - 2)");
lines.push("fibonacci: " + fibonacci(fibonacci, 15));
const through = new Function("compiled", "n", "return n ? compiled(n - 1) + 1 : 0");
function compiledBetween(n) { return through(compiledBetween, n); }
lines.push("through: " + compiledBetween(200));
const endless = new Function("self", "return self(self) + 1");
show("endless", () => endless(endless));
show("after endless", () => fibonacci(fibonacci, 10));

// Methods.
const callMethod = () => new Function("object", "a", "return object.method(a)");
const readMethod = () => new Function("object", "return object.method");
function makeChain() {
  const top = { method(a) { return ["top", a]; } };
  const middle = Object.create(top);
  const bottom = Object.create(middle);
  return { top, middle, bottom };
}
const changesOfChains = {
  replacedAtTop(chain) { chain.top.method = function replaced(a) { return ["replaced", a]; }; },
  shadowedInTheMiddle(chain) { chain.middle.method = function shadowing(a) { return ["middle", a]; }; },
  ownProperty(chain) { chain.bottom.method = function own(a) { return ["own", a]; }; },
  deleted(chain) { delete chain.top.method; },
  getter(chain) { Object.defineProperty(chain.top, "method", { get() { return function got(a) { return ["got", a]; }; } }); },
  otherPrototype(chain) { Object.setPrototypeOf(chain.bottom, { method(a) { return ["elsewhere", a]; } }); },
  middleGetsOtherPrototype(chain) { Object.setPrototypeOf(chain.middle, { method(a) { return ["above the middle", a]; } }); },
  noPrototype(chain) { Object.setPrototypeOf(chain.bottom, null); },
  manyPropertiesAtTop(chain) { for (let i = 0; i < 100; i++) chain.top["p" + i] = i; },
  manyThenDeleted(chain) { for (let i = 0; i < 100; i++) chain.top["p" + i] = i; for (let i = 0; i < 100; i++) delete chain.top["p" + i]; },
  notCallable(chain) { chain.top.method = 5; },
};
for (const [change, apply] of Object.entries(changesOfChains)) {
  const chain = makeChain();
  const call = callMethod();
  const read = readMethod();
  for (let i = 0; i < 300; i++) call(chain.bottom, i), read(chain.bottom);
  show(`${change} before`, () => [call(chain.bottom, 1), read(chain.bottom)]);
  apply(chain);
  show(`${change} call`, () => call(chain.bottom, 2));
  show(`${change} read`, () => read(chain.bottom));
  for (let i = 0; i < 300; i++) { try { call(chain.bottom, i); } catch {} read(chain.bottom); }
  show(`${change} warm again`, () => [call(chain.bottom, 3), read(chain.bottom)]);
}
const receivers = {
  instance: () => new Class("instance"), heir: () => new (class Heir extends Class {})("heir"), overriding: () => new (class Overriding extends Class { method(a) { return ["overridden", super.method(a)]; } })("overriding"),
  ordinary: () => ({ method(a) { return ["ordinary", a]; } }), chain: () => makeChain().bottom, string: () => "text", number: () => 5, array: () => [1, 2], nothing: () => undefined, withoutMethod: () => ({}),
};
String.prototype.method = function (a) { "use strict"; return [typeof this, a]; };
Number.prototype.method = function (a) { return [typeof this, a]; };
Array.prototype.method = function (a) { return [this.length, a]; };
for (const warmWith of ["instance", "chain", "string", "array"]) {
  const call = callMethod();
  const warm = receivers[warmWith]();
  for (let i = 0; i < 300; i++) call(warm, i);
  for (const [name, create] of Object.entries(receivers)) show(`method ${warmWith} ${name}`, () => call(create(), "argument"));
}
const builtins = new Function("text", "list", "i", "return [text.charCodeAt(i), text.slice(i), text.length, list.indexOf(i), list.slice(i).length, list.length]");
for (let i = 0; i < 300; i++) builtins("some text", [0, 1, 2, 3], i % 4);
show("built-ins", () => builtins("some text", [0, 1, 2, 3], 2));
delete String.prototype.method;
delete Number.prototype.method;
delete Array.prototype.method;
console.log(lines.join("\n"));
