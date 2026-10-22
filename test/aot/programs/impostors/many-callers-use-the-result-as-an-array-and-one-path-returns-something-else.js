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

function forLengthOf(value, which, text) {
  if (which === 1) return "12";
  if (which === 2) return (0, eval)(text);
  return value;
}

function lengthOf(value, which, text) {
  return forLengthOf(value, which, text).length;
}

function forFirstOf(value, which, text) {
  if (which === 1) return null;
  if (which === 2) return (0, eval)(text);
  return value;
}

function firstOf(value, which, text) {
  return forFirstOf(value, which, text)[0];
}

function forPushedTo(value, which, text) {
  if (which === 1) return { 0: 1, length: 1 };
  if (which === 2) return (0, eval)(text);
  return value;
}

function pushedTo(value, which, text) {
  return forPushedTo(value, which, text).push(1);
}

function forCounted(value, which, text) {
  if (which === 1) return new Set([1, 2]);
  if (which === 2) return (0, eval)(text);
  return value;
}

function counted(value, which, text) {
  let n = 0;
  for (const item of forCounted(value, which, text)) n++;
  return n;
}

function forMapped(value, which, text) {
  if (which === 1) return new Uint8Array([1, 2]);
  if (which === 2) return (0, eval)(text);
  return value;
}

function mapped(value, which, text) {
  return forMapped(value, which, text).map(item => item + 1);
}

function forSpread(value, which, text) {
  if (which === 1) return undefined;
  if (which === 2) return (0, eval)(text);
  return value;
}

function spread(value, which, text) {
  return [...forSpread(value, which, text)];
}

function forUnpacked(value, which, text) {
  if (which === 1) return 5;
  if (which === 2) return (0, eval)(text);
  return value;
}

function unpacked(value, which, text) {
  const [first, second] = forUnpacked(value, which, text);
  return [first, second];
}

function forJoined(value, which, text) {
  if (which === 1) return new Map([[1, 2]]);
  if (which === 2) return (0, eval)(text);
  return value;
}

function joined(value, which, text) {
  return forJoined(value, which, text).join("-");
}

function forSearched(value, which, text) {
  if (which === 1) return "2";
  if (which === 2) return (0, eval)(text);
  return value;
}

function searched(value, which, text) {
  return forSearched(value, which, text).indexOf(2);
}

function forSummed(value, which, text) {
  if (which === 1) return { length: 2 };
  if (which === 2) return (0, eval)(text);
  return value;
}

function summed(value, which, text) {
  const list = forSummed(value, which, text);
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function forStored(value, which, text) {
  if (which === 1) return Object.freeze([1]);
  if (which === 2) return (0, eval)(text);
  return value;
}

function stored(value, which, text) {
  const list = forStored(value, which, text);
  list[1] = 9;
  return list.length;
}

function forTested(value, which, text) {
  if (which === 1) return new Proxy([], {});
  if (which === 2) return (0, eval)(text);
  return value;
}

function tested(value, which, text) {
  return Array.isArray(forTested(value, which, text));
}

const hidden = [
  "\"12\"",
  "null",
  "undefined",
  "5",
  "({ 0: 1, 1: 2, length: 2 })",
  "new Set([1, 2])",
  "new Uint8Array([1, 2])",
  "(function () { return arguments; })(1, 2)",
  "Object.freeze([1, 2])",
  "new Array(2)",
  "new (class extends Array { push() { return \"mine\"; } map() { return \"mine\"; } join() { return \"mine\"; } indexOf() { return \"mine\"; } })(1, 2)",
  "new Proxy([1, 2], {})",
  "({ length: 1, 0: 2, push() { return \"its own\"; }, map() { return \"its own\"; }, join() { return \"its own\"; }, indexOf() { return \"its own\"; }, *[Symbol.iterator]() { yield 8; } })",
];

function honest(round) {
  console.log(round, "lengthOf", show(lengthOf([1, 2, 3])), show(lengthOf([])), show(lengthOf(new Array(4, 5))), show(lengthOf([0.5])), show(lengthOf(Array.of(6))));
  console.log(round, "firstOf", show(firstOf([1, 2, 3])), show(firstOf([])), show(firstOf(new Array(4, 5))), show(firstOf([0.5])), show(firstOf(Array.of(6))));
  console.log(round, "pushedTo", show(pushedTo([1, 2, 3])), show(pushedTo([])), show(pushedTo(new Array(4, 5))), show(pushedTo([0.5])), show(pushedTo(Array.of(6))));
  console.log(round, "counted", show(counted([1, 2, 3])), show(counted([])), show(counted(new Array(4, 5))), show(counted([0.5])), show(counted(Array.of(6))));
  console.log(round, "mapped", show(mapped([1, 2, 3])), show(mapped([])), show(mapped(new Array(4, 5))), show(mapped([0.5])), show(mapped(Array.of(6))));
  console.log(round, "spread", show(spread([1, 2, 3])), show(spread([])), show(spread(new Array(4, 5))), show(spread([0.5])), show(spread(Array.of(6))));
  console.log(round, "unpacked", show(unpacked([1, 2, 3])), show(unpacked([])), show(unpacked(new Array(4, 5))), show(unpacked([0.5])), show(unpacked(Array.of(6))));
  console.log(round, "joined", show(joined([1, 2, 3])), show(joined([])), show(joined(new Array(4, 5))), show(joined([0.5])), show(joined(Array.of(6))));
  console.log(round, "searched", show(searched([1, 2, 3])), show(searched([])), show(searched(new Array(4, 5))), show(searched([0.5])), show(searched(Array.of(6))));
  console.log(round, "summed", show(summed([1, 2, 3])), show(summed([])), show(summed(new Array(4, 5))), show(summed([0.5])), show(summed(Array.of(6))));
  console.log(round, "stored", show(stored([1, 2, 3])), show(stored([])), show(stored(new Array(4, 5))), show(stored([0.5])), show(stored(Array.of(6))));
  console.log(round, "tested", show(tested([1, 2, 3])), show(tested([])), show(tested(new Array(4, 5))), show(tested([0.5])), show(tested(Array.of(6))));
}

honest("before");
attempt("lengthOf, the other path in sight", () => lengthOf(undefined, 1));
for (const text of hidden) attempt("lengthOf of " + text, () => lengthOf(undefined, 2, text));
attempt("firstOf, the other path in sight", () => firstOf(undefined, 1));
for (const text of hidden) attempt("firstOf of " + text, () => firstOf(undefined, 2, text));
attempt("pushedTo, the other path in sight", () => pushedTo(undefined, 1));
for (const text of hidden) attempt("pushedTo of " + text, () => pushedTo(undefined, 2, text));
attempt("counted, the other path in sight", () => counted(undefined, 1));
for (const text of hidden) attempt("counted of " + text, () => counted(undefined, 2, text));
attempt("mapped, the other path in sight", () => mapped(undefined, 1));
for (const text of hidden) attempt("mapped of " + text, () => mapped(undefined, 2, text));
attempt("spread, the other path in sight", () => spread(undefined, 1));
for (const text of hidden) attempt("spread of " + text, () => spread(undefined, 2, text));
attempt("unpacked, the other path in sight", () => unpacked(undefined, 1));
for (const text of hidden) attempt("unpacked of " + text, () => unpacked(undefined, 2, text));
attempt("joined, the other path in sight", () => joined(undefined, 1));
for (const text of hidden) attempt("joined of " + text, () => joined(undefined, 2, text));
attempt("searched, the other path in sight", () => searched(undefined, 1));
for (const text of hidden) attempt("searched of " + text, () => searched(undefined, 2, text));
attempt("summed, the other path in sight", () => summed(undefined, 1));
for (const text of hidden) attempt("summed of " + text, () => summed(undefined, 2, text));
attempt("stored, the other path in sight", () => stored(undefined, 1));
for (const text of hidden) attempt("stored of " + text, () => stored(undefined, 2, text));
attempt("tested, the other path in sight", () => tested(undefined, 1));
for (const text of hidden) attempt("tested of " + text, () => tested(undefined, 2, text));
honest("after");
