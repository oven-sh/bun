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

function timesTwo(value) {
  return value * 2;
}

function plusOne(value) {
  return value + 1;
}

function truncated(value) {
  return value | 0;
}

function lessThanTen(value) {
  return value < 10;
}

function all(value) {
  return [timesTwo(value), plusOne(value), truncated(value), lessThanTen(value)];
}

function numeric(value) {
  return [timesTwo(value), truncated(value), lessThanTen(value), typeof plusOne(value)];
}

for (let i = 0; i < 2000; i++) all(i);

// The members of Date.prototype are fixed in a compiled program, but for toString, which packages replace. A class below Date has a prototype of its own.
class Stamp extends Date {}
const toString = Date.prototype.toString;

attempt("a date before", () => numeric(new Date(5)));
attempt("a stamp before", () => numeric(new Stamp(5)));
Stamp.prototype.valueOf = () => 48;
attempt("valueOf replaced", () => numeric(new Stamp(5)));
Stamp.prototype.valueOf = () => "49";
attempt("valueOf gives a text", () => numeric(new Stamp(5)));
Stamp.prototype.valueOf = () => ({});
attempt("valueOf gives an object", () => numeric(new Stamp(5)));
delete Stamp.prototype.valueOf;
attempt("valueOf restored", () => numeric(new Stamp(5)));
Date.prototype.toString = () => "50";
attempt("Date.prototype.toString replaced", () => all(new Date(5)));
Date.prototype.toString = () => 51;
attempt("Date.prototype.toString gives a number", () => all(new Date(5)));
Date.prototype.toString = toString;
Object.defineProperty(Stamp.prototype, Symbol.toPrimitive, { value: hint => (hint === "number" ? 52 : hint === "default" ? 53 : "54"), configurable: true });
attempt("[Symbol.toPrimitive] replaced", () => all(new Stamp(5)));
Object.defineProperty(Stamp.prototype, Symbol.toPrimitive, { value: undefined, configurable: true });
attempt("[Symbol.toPrimitive] is undefined", () => numeric(new Stamp(5)));
delete Stamp.prototype[Symbol.toPrimitive];
attempt("[Symbol.toPrimitive] deleted", () => numeric(new Stamp(5)));
const own = new Date(5);
own.valueOf = () => 55;
attempt("valueOf of one date", () => numeric(own));
Object.defineProperty(own, Symbol.toPrimitive, { value: () => 56 });
attempt("[Symbol.toPrimitive] of one date", () => all(own));
attempt("a date after", () => numeric(new Date(5)));
attempt("honest numbers afterwards", () => all(5));
