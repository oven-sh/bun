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

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function forCalled(value, which, text) {
  if (which === 1) return class {};
  if (which === 2) return (0, eval)(text);
  return value;
}

function called(value, which, text) {
  return forCalled(value, which, text)(1);
}

function forCalledMaybe(value, which, text) {
  if (which === 1) return null;
  if (which === 2) return (0, eval)(text);
  return value;
}

function calledMaybe(value, which, text) {
  return forCalledMaybe(value, which, text)?.(1);
}

function forBuilt(value, which, text) {
  if (which === 1) return () => 1;
  if (which === 2) return (0, eval)(text);
  return value;
}

function built(value, which, text) {
  return typeof new (forBuilt(value, which, text))(1);
}

function forThroughCall(value, which, text) {
  if (which === 1) return { call: () => "its own call" };
  if (which === 2) return (0, eval)(text);
  return value;
}

function throughCall(value, which, text) {
  return forThroughCall(value, which, text).call(null, 1);
}

function forThroughApply(value, which, text) {
  if (which === 1) return { apply: () => "its own apply" };
  if (which === 2) return (0, eval)(text);
  return value;
}

function throughApply(value, which, text) {
  return forThroughApply(value, which, text).apply(null, [1]);
}

function forBound(value, which, text) {
  if (which === 1) return { bind: () => () => "its own bind" };
  if (which === 2) return (0, eval)(text);
  return value;
}

function bound(value, which, text) {
  return forBound(value, which, text).bind(null, 1)();
}

function forAsCallback(value, which, text) {
  if (which === 1) return undefined;
  if (which === 2) return (0, eval)(text);
  return value;
}

function asCallback(value, which, text) {
  return [1].map(forAsCallback(value, which, text));
}

function forAsTag(value, which, text) {
  if (which === 1) return "text";
  if (which === 2) return (0, eval)(text);
  return value;
}

function asTag(value, which, text) {
  return typeof forAsTag(value, which, text)`text`;
}

function forLengthOf(value, which, text) {
  if (which === 1) return [1, 2];
  if (which === 2) return (0, eval)(text);
  return value;
}

function lengthOf(value, which, text) {
  return forLengthOf(value, which, text).length;
}

function forNameOf(value, which, text) {
  if (which === 1) return { name: "its own name" };
  if (which === 2) return (0, eval)(text);
  return value;
}

function nameOf(value, which, text) {
  return forNameOf(value, which, text).name;
}

function forKindOf(value, which, text) {
  if (which === 1) return class {};
  if (which === 2) return (0, eval)(text);
  return value;
}

function kindOf(value, which, text) {
  return typeof forKindOf(value, which, text);
}

function forInstanceTest(value, which, text) {
  if (which === 1) return { [Symbol.hasInstance]: () => true };
  if (which === 2) return (0, eval)(text);
  return value;
}

function instanceTest(value, which, text) {
  return ({}) instanceof forInstanceTest(value, which, text);
}

const hidden = [
  "(class { constructor() { this.made = true; } })",
  "null",
  "undefined",
  "\"text\"",
  "5",
  "({})",
  "({ call() { return \"its own\"; }, apply() { return \"its own\"; }, bind() { return () => \"its own\"; }, length: \"its own\", name: \"its own\" })",
  "async v => v",
  "(function* (v) { yield v; })",
  "(function (a, b) { return [this === null, a, b]; }).bind(null, 0)",
  "new Proxy(function () {}, { apply() { return \"trapped\"; }, construct() { return {}; } })",
  "Math.max",
  "({ m(v) { return v; } }).m",
];

function honest(round) {
  console.log(round, "called", show(called(function (v) { return v; })), show(called(function (v) { return 2; })), show(called(function () { return 3; })), show(called(function named() { return 4; })), show(called(function (v) { return [v]; })));
  console.log(round, "calledMaybe", show(calledMaybe(function (v) { return v; })), show(calledMaybe(function (v) { return 2; })), show(calledMaybe(function () { return 3; })), show(calledMaybe(function named() { return 4; })), show(calledMaybe(function (v) { return [v]; })));
  console.log(round, "built", show(built(function (v) { return v; })), show(built(function (v) { return 2; })), show(built(function () { return 3; })), show(built(function named() { return 4; })), show(built(function (v) { return [v]; })));
  console.log(round, "throughCall", show(throughCall(function (v) { return v; })), show(throughCall(function (v) { return 2; })), show(throughCall(function () { return 3; })), show(throughCall(function named() { return 4; })), show(throughCall(function (v) { return [v]; })));
  console.log(round, "throughApply", show(throughApply(function (v) { return v; })), show(throughApply(function (v) { return 2; })), show(throughApply(function () { return 3; })), show(throughApply(function named() { return 4; })), show(throughApply(function (v) { return [v]; })));
  console.log(round, "bound", show(bound(function (v) { return v; })), show(bound(function (v) { return 2; })), show(bound(function () { return 3; })), show(bound(function named() { return 4; })), show(bound(function (v) { return [v]; })));
  console.log(round, "asCallback", show(asCallback(function (v) { return v; })), show(asCallback(function (v) { return 2; })), show(asCallback(function () { return 3; })), show(asCallback(function named() { return 4; })), show(asCallback(function (v) { return [v]; })));
  console.log(round, "asTag", show(asTag(function (v) { return v; })), show(asTag(function (v) { return 2; })), show(asTag(function () { return 3; })), show(asTag(function named() { return 4; })), show(asTag(function (v) { return [v]; })));
  console.log(round, "lengthOf", show(lengthOf(function (v) { return v; })), show(lengthOf(function (v) { return 2; })), show(lengthOf(function () { return 3; })), show(lengthOf(function named() { return 4; })), show(lengthOf(function (v) { return [v]; })));
  console.log(round, "nameOf", show(nameOf(function (v) { return v; })), show(nameOf(function (v) { return 2; })), show(nameOf(function () { return 3; })), show(nameOf(function named() { return 4; })), show(nameOf(function (v) { return [v]; })));
  console.log(round, "kindOf", show(kindOf(function (v) { return v; })), show(kindOf(function (v) { return 2; })), show(kindOf(function () { return 3; })), show(kindOf(function named() { return 4; })), show(kindOf(function (v) { return [v]; })));
  console.log(round, "instanceTest", show(instanceTest(function (v) { return v; })), show(instanceTest(function (v) { return 2; })), show(instanceTest(function () { return 3; })), show(instanceTest(function named() { return 4; })), show(instanceTest(function (v) { return [v]; })));
}

honest("before");
attempt("called, the other path in sight", () => called(undefined, 1));
for (const text of hidden) attempt("called of " + text, () => called(undefined, 2, text));
attempt("calledMaybe, the other path in sight", () => calledMaybe(undefined, 1));
for (const text of hidden) attempt("calledMaybe of " + text, () => calledMaybe(undefined, 2, text));
attempt("built, the other path in sight", () => built(undefined, 1));
for (const text of hidden) attempt("built of " + text, () => built(undefined, 2, text));
attempt("throughCall, the other path in sight", () => throughCall(undefined, 1));
for (const text of hidden) attempt("throughCall of " + text, () => throughCall(undefined, 2, text));
attempt("throughApply, the other path in sight", () => throughApply(undefined, 1));
for (const text of hidden) attempt("throughApply of " + text, () => throughApply(undefined, 2, text));
attempt("bound, the other path in sight", () => bound(undefined, 1));
for (const text of hidden) attempt("bound of " + text, () => bound(undefined, 2, text));
attempt("asCallback, the other path in sight", () => asCallback(undefined, 1));
for (const text of hidden) attempt("asCallback of " + text, () => asCallback(undefined, 2, text));
attempt("asTag, the other path in sight", () => asTag(undefined, 1));
for (const text of hidden) attempt("asTag of " + text, () => asTag(undefined, 2, text));
attempt("lengthOf, the other path in sight", () => lengthOf(undefined, 1));
for (const text of hidden) attempt("lengthOf of " + text, () => lengthOf(undefined, 2, text));
attempt("nameOf, the other path in sight", () => nameOf(undefined, 1));
for (const text of hidden) attempt("nameOf of " + text, () => nameOf(undefined, 2, text));
attempt("kindOf, the other path in sight", () => kindOf(undefined, 1));
for (const text of hidden) attempt("kindOf of " + text, () => kindOf(undefined, 2, text));
attempt("instanceTest, the other path in sight", () => instanceTest(undefined, 1));
for (const text of hidden) attempt("instanceTest of " + text, () => instanceTest(undefined, 2, text));
honest("after");
