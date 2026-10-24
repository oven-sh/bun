// Operators and conversions on any value run user code in order and throw what JavaScript throws.
module.exports = {};

const log = [];
function show(name, f) {
  log.length = 0;
  let text;
  try {
    const value = f();
    text = typeof value + " " + String(value);
  } catch (e) {
    text = "throws " + e.constructor.name;
  }
  console.log(name + ": " + text + (log.length ? " after " + log.join(",") : ""));
}
const operands = {
  "valueOf": () => ({ valueOf() { log.push("valueOf"); return 3; }, toString() { log.push("toString"); return "4"; } }),
  "toString": () => ({ valueOf() { log.push("valueOf"); return {}; }, toString() { log.push("toString"); return "4"; } }),
  "toPrimitive": () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return hint === "string" ? "text" : 5; } }),
  "toPrimitive bigint": () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return 7n; } }),
  "valueOf throws": () => ({ valueOf() { log.push("valueOf"); throw new RangeError("no"); }, toString() { log.push("toString"); throw new SyntaxError("no"); } }),
  "no primitive": () => ({ valueOf() { log.push("valueOf"); return {}; }, toString() { log.push("toString"); return {}; } }),
  "bigint": () => 6n,
  "symbol": () => Symbol("s"),
  "string": () => "12",
  "empty string": () => "",
  "text": () => "abc",
  "boolean": () => true,
  "null": () => null,
  "undefined": () => undefined,
  "array": () => [8],
  "number": () => 2,
  "double": () => 2.5,
  "negative zero": () => -0,
  "NaN": () => NaN,
  "large": () => 2 ** 40,
};
function power(a, b) { return a ** b; }
function negate(a) { return -a; }
function bitNot(a) { return ~a; }
function plus(a) { return +a; }
function template(a) { return `<${a}>`; }
function computedKey(a) { const object = {}; object[a] = 1; return Reflect.ownKeys(object).map(String).join(); }
function computedRead(a) { return { 12: "twelve", 3: "three", text: "word" }[a]; }
function literalKey(a) { return Object.keys({ [a]: 1 }).join(); }
function typeOf(a) { return typeof a; }
function stringOf(a) { return String(a); }
function numberOf(a) { return Number(a); }
for (const name in operands) {
  const make = operands[name];
  show(name + " ** 2", () => power(make(), 2));
  show("2 ** " + name, () => power(2, make()));
  show("2n ** " + name, () => power(2n, make()));
  show("-" + name, () => negate(make()));
  show("~" + name, () => bitNot(make()));
  show("+" + name, () => plus(make()));
  show("template " + name, () => template(make()));
  show("key " + name, () => computedKey(make()));
  show("read " + name, () => computedRead(make()));
  show("literal key " + name, () => literalKey(make()));
  show("typeof " + name, () => typeOf(make()));
  show("String " + name, () => stringOf(make()));
  show("Number " + name, () => numberOf(make()));
}
show("left first", () => power({ valueOf() { log.push("left"); return 2; } }, { valueOf() { log.push("right"); return 3; } }));
show("negate bigint zero", () => negate(0n));
show("negative exponent", () => power(2n, -1n));
console.log(Object.is(negate(0), -0), Object.is(negate(-0), 0), bitNot(2 ** 32 + 1), bitNot(-1n), power(-8, 1 / 3), power(1, Infinity), power(NaN, 0));

function receiver() { return this; }
function receiverKind() { return typeof this; }
const strictReceiver = function () { "use strict"; return this; };
console.log(receiver.call(null) === globalThis, receiver.call(undefined) === globalThis, receiver() === globalThis);
console.log(receiverKind.call(5), receiverKind.call("s"), receiverKind.call(true), receiverKind.call(Symbol.iterator), receiverKind.call(1n));
console.log(receiver.call(5) instanceof Number, receiver.call(5).valueOf(), receiver.call("s") instanceof String, receiver.call("s").length, receiver.call(5) === receiver.call(5));
const self = {};
// A "use strict" at the head of a function follows the file, and this file is sloppy. The receivers are compared and not printed: the global object shows the command line and the environment.
console.log(receiver.call(self) === self, typeof strictReceiver.call(5), strictReceiver.call(null) === globalThis, strictReceiver.call(undefined) === globalThis);

function destructureEmpty(value) { const {} = value; return "done"; }
function destructureField(value) { const { a } = value; return a; }
function destructureParameter({ a }) { return a; }
function destructureNested({ a: { b } }) { return b; }
function destructureRest(value) { const { ...rest } = value; return Object.keys(rest).join(); }
for (const value of [null, undefined, 0, "", "ab", false, 1n, Symbol.iterator, { a: 1 }, { a: null }, { a: { b: 2 } }]) {
  const name = String(value && typeof value === "object" ? JSON.stringify(value) : value);
  show("empty pattern " + name, () => destructureEmpty(value));
  show("field " + name, () => destructureField(value));
  show("parameter " + name, () => destructureParameter(value));
  show("nested " + name, () => destructureNested(value));
  show("rest " + name, () => destructureRest(value));
}
show("Object of null", () => Object(null) instanceof Object);
show("Object of number", () => Object(1) instanceof Number);
show("member of null", () => null.x);
show("member of undefined", () => undefined[0]);
