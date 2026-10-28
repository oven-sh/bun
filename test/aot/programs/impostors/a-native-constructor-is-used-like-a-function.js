function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];
const atFirst = new Map();
let same = 0;

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  if (log.length) line += ", log " + log.join(" ");
  if (!atFirst.has(label)) console.log(label + ":", line);
  else if (atFirst.get(label) === line) same++;
  else console.log("changed, " + label + ":", line);
  atFirst.set(label, line);
}

function callIt(f) {
  return f(1, 2);
}

function callItIfThere(f) {
  return f?.(1, 2);
}

function buildIt(f) {
  return new f(1, 2);
}

function callItAsAMethod(f) {
  const holder = { name: "holder", f };
  return holder.f(1, 2);
}

function handItToMap(f) {
  return [1, 2].map(f);
}

function throughCall(f) {
  return f.call("self", 1, 2);
}

function throughApply(f) {
  return f.apply("self", [1, 2]);
}

function throughBind(f) {
  return f.bind("self", 1)(2);
}

function throughReflect(f) {
  return Reflect.apply(f, "self", [1, 2]);
}

function tagWithIt(f) {
  return f`a${1}b`;
}

function testAnInstance(f) {
  return {} instanceof f;
}

function lengthOf(f) {
  return f.length;
}

function nameOf(f) {
  return f.name;
}

function prototypeOf(f) {
  return typeof f.prototype;
}

function kindOf(f) {
  return typeof f;
}

function plus(a, b) {
  return a + b;
}

function minus(a, b) {
  return a - b;
}

function first(a) {
  return a;
}

function honest(round) {
  console.log(round, "callIt", show(callIt(plus)), show(callIt(minus)), show(callIt(first)), show(callIt(function (a, b) { return [a, b]; })));
  console.log(round, "callItIfThere", show(callItIfThere(plus)), show(callItIfThere(minus)), show(callItIfThere(first)), show(callItIfThere(function (a, b) { return [a, b]; })));
  console.log(round, "buildIt", show(buildIt(plus)), show(buildIt(minus)), show(buildIt(first)), show(buildIt(function (a, b) { this.a = a; this.b = b; })));
  console.log(round, "callItAsAMethod", show(callItAsAMethod(plus)), show(callItAsAMethod(minus)), show(callItAsAMethod(first)), show(callItAsAMethod(function () { return this.name; })));
  console.log(round, "handItToMap", show(handItToMap(plus)), show(handItToMap(minus)), show(handItToMap(first)), show(handItToMap(function (a, b) { return [a, b]; })));
  console.log(round, "throughCall", show(throughCall(plus)), show(throughCall(minus)), show(throughCall(first)), show(throughCall(function () { return String(this); })));
  console.log(round, "throughApply", show(throughApply(plus)), show(throughApply(minus)), show(throughApply(first)), show(throughApply(function () { return String(this); })));
  console.log(round, "throughBind", show(throughBind(plus)), show(throughBind(minus)), show(throughBind(first)), show(throughBind(function () { return String(this); })));
  console.log(round, "throughReflect", show(throughReflect(plus)), show(throughReflect(minus)), show(throughReflect(first)), show(throughReflect(function () { return String(this); })));
  console.log(round, "tagWithIt", show(tagWithIt(plus)), show(tagWithIt(minus)), show(tagWithIt(first)), show(tagWithIt(function (strings) { return strings.raw; })));
  console.log(round, "testAnInstance", testAnInstance(plus), testAnInstance(minus), testAnInstance(first), testAnInstance(Object));
  console.log(round, "lengthOf", lengthOf(plus), lengthOf(minus), lengthOf(first), lengthOf(function () {}));
  console.log(round, "nameOf", nameOf(plus), nameOf(minus), nameOf(first), show(nameOf(function () {})));
  console.log(round, "prototypeOf", prototypeOf(plus), prototypeOf(minus), prototypeOf(first), prototypeOf(function () {}));
  console.log(round, "kindOf", kindOf(plus), kindOf(minus), kindOf(first), kindOf(function () {}));
}

const impostors = [
  ["String", () => String],
  ["Number", () => Number],
  ["Boolean", () => Boolean],
  ["Array", () => Array],
  ["Object", () => Object],
  ["Symbol", () => Symbol],
  ["BigInt", () => BigInt],
  ["Map", () => Map],
  ["Set", () => Set],
  ["Promise", () => Promise],
  ["Proxy", () => Proxy],
  ["Error", () => Error],
  ["Uint8Array", () => Uint8Array],
  ["ArrayBuffer", () => ArrayBuffer],
];

function meetTheImpostors() {
  for (const [name, make] of impostors) {
    attempt("callIt, " + name, () => callIt(make()));
    attempt("callItIfThere, " + name, () => callItIfThere(make()));
    attempt("buildIt, " + name, () => buildIt(make()));
    attempt("callItAsAMethod, " + name, () => callItAsAMethod(make()));
    attempt("handItToMap, " + name, () => handItToMap(make()));
    attempt("throughCall, " + name, () => throughCall(make()));
    attempt("throughApply, " + name, () => throughApply(make()));
    attempt("throughBind, " + name, () => throughBind(make()));
    attempt("throughReflect, " + name, () => throughReflect(make()));
    attempt("tagWithIt, " + name, () => tagWithIt(make()));
    attempt("testAnInstance, " + name, () => testAnInstance(make()));
    attempt("lengthOf, " + name, () => lengthOf(make()));
    attempt("nameOf, " + name, () => nameOf(make()));
    attempt("prototypeOf, " + name, () => prototypeOf(make()));
    attempt("kindOf, " + name, () => kindOf(make()));
  }
}

meetTheImpostors();
honest("after the impostors came first");
for (let i = 0; i < 2000; i++) {
  const f = i % 2 ? plus : minus;
  callIt(f);
  callItIfThere(f);
  buildIt(f);
  callItAsAMethod(f);
  handItToMap(f);
  throughCall(f);
  throughApply(f);
  throughBind(f);
  throughReflect(f);
  tagWithIt(f);
  testAnInstance(f);
  lengthOf(f);
  nameOf(f);
  prototypeOf(f);
  kindOf(f);
}
meetTheImpostors();
console.log("the same after 2000 honest calls:", same);
honest("at the end");
