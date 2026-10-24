function show(value) {
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

function useLikeAnArray(text) {
  var array = eval(text);
  array?.push(123);
  array?.sort();
  return array?.filter(a => a);
}

function useLikeAnArrayWithoutChains(text) {
  var array = (0, eval)(text);
  array.push(123);
  array.sort();
  return array.filter(a => a);
}

const texts = [
  "{}",
  "({})",
  "[]",
  "[3, 0, 1]",
  "null",
  "undefined",
  "0",
  "''",
  "'abc'",
  "({ length: 0 })",
  "({ push() { return 'pushed'; } })",
  "({ push() {}, sort() {}, filter() { return 'filtered'; } })",
  "({ push: Array.prototype.push, sort: Array.prototype.sort, filter: Array.prototype.filter, length: 0 })",
  "({ __proto__: Array.prototype })",
  "Object.create(Array.prototype, { length: { value: 0, writable: true } })",
  "new Proxy([], {})",
  "new Proxy([], { get(target, key, receiver) { return key === 'filter' ? () => 'trapped' : Reflect.get(target, key, receiver); } })",
  "Object.freeze([])",
  "new Uint8Array(2)",
  "new Set()",
  "(function () { return arguments; })(1, 2)",
];

for (let round = 0; round < 3; round++) {
  for (const text of texts) {
    attempt(round + " chained " + text + " ->", () => useLikeAnArray(text));
    attempt(round + " plain " + text + " ->", () => useLikeAnArrayWithoutChains(text));
  }
}

for (let i = 0; i < 2000; i++) useLikeAnArray("[]");
for (const text of texts) attempt("after 2000 arrays " + text + " ->", () => useLikeAnArray(text));
