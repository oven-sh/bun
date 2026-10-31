// This in callbacks that built ins call sloppy.
console.log("strict:", (function () {
  return this === undefined;
})());

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (value === globalThis) return "the global object";
  if (Array.isArray(value)) return "[" + Array.from(value, (item, index) => (index in value ? show(item) : "hole")).join(", ") + "]";
  var tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Arguments") return "arguments" + show(Array.from(value));
  if (/^(Number|String|Boolean|BigInt|Symbol)$/.test(tag)) return "boxed " + show(Object.getPrototypeOf(value).valueOf.call(value));
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

function describe(self) {
  return self === undefined ? "undefined" : self === null ? "null" : self === globalThis ? "the global object" : typeof self === "object" ? "object " + Object.prototype.toString.call(self).slice(8, -1) : typeof self;
}
var seen = [];
function note() {
  seen.push(describe(this));
  return 0;
}
function noted(run) {
  seen.length = 0;
  run();
  return seen.slice(0, 2);
}
var holder = { toJSON: note, valueOf: note, toString: note, [Symbol.toPrimitive]: note };

attempt("forEach", () => noted(() => [1].forEach(note)));
attempt("forEach with 5", () => noted(() => [1].forEach(note, 5)));
attempt("forEach with a text", () => noted(() => [1].forEach(note, "text")));
attempt("forEach with null", () => noted(() => [1].forEach(note, null)));
attempt("forEach with false", () => noted(() => [1].forEach(note, false)));
attempt("map", () => noted(() => [1].map(note)));
attempt("filter with a symbol", () => noted(() => [1].filter(note, Symbol.iterator)));
attempt("reduce", () => noted(() => [1, 2].reduce(note)));
attempt("sort", () => noted(() => [2, 1].sort(note)));
attempt("Array.from", () => noted(() => Array.from([1], note)));
attempt("Array.from with 5", () => noted(() => Array.from([1], note, 5)));
attempt("a typed array's map with 5", () => noted(() => new Uint8Array(1).map(note, 5)));
attempt("a map's forEach", () => noted(() => new Map([[1, 2]]).forEach(note)));
attempt("a set's forEach with 5n", () => noted(() => new Set([1]).forEach(note, 5n)));
attempt("replace", () => noted(() => "a".replace("a", note)));
attempt("replace with an expression", () => noted(() => "a".replace(/a/g, note)));
attempt("JSON.parse", () => noted(() => JSON.parse("[1]", note)));
attempt("JSON.stringify", () => noted(() => JSON.stringify([1], note)));
attempt("toJSON", () => noted(() => JSON.stringify(holder)));
attempt("Symbol.toPrimitive", () => noted(() => +holder));
attempt("new Promise", () => noted(() => new Promise(note)));
attempt("Reflect.apply with 5", () => noted(() => Reflect.apply(note, 5, [])));
attempt("Reflect.apply with undefined", () => noted(() => Reflect.apply(note, undefined, [])));
attempt("bind(5)", () => noted(() => note.bind(5)()));
attempt("bind()", () => noted(() => note.bind()()));
attempt("bind(5) as a method", () => noted(() => ({ note: note.bind(5) }).note()));
attempt("a getter read off a number", () => noted(() => Reflect.get({ get a() { return note.call(this); } }, "a", 5)));
attempt("a proxy's trap", () => noted(() => new Proxy({}, { get: note }).a));
attempt("a tagged template", () => noted(() => note``));
attempt("an iterator's next", () => noted(() => { for (var item of { [Symbol.iterator]: function () { note.call(this); return { next: function () { note.call(this); return { done: true }; } }; } }); }));
attempt("a finalizer of flatMap with true", () => noted(() => [1].flatMap(note, true)));
var later = [];
Promise.resolve(1)
  .then(function () {
    later.push("then: " + describe(this));
  })
  .then(() => new Promise(resolve => setTimeout(function () {
    later.push("timer: " + (this === undefined ? "undefined" : this === globalThis ? "the global object" : typeof this));
    resolve();
  }, 0)))
  .then(() => new Promise(resolve => queueMicrotask(function () {
    later.push("microtask: " + describe(this));
    resolve();
  })))
  .then(() => console.log(later.join("; ")));
