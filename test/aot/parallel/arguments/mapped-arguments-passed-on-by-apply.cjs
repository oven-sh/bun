// COUNTER: operationAOTNewArgumentList <= 40
// A function that assigns to its parameter passes its arguments on: each number of them is a call, and no list is made.
globalThis.keep = function (words, size) { this.words = words || "none"; this.size = size === undefined ? "no size" : size; this.count = arguments.length; return this; };
const kept = globalThis.keep;
globalThis.start = function (words) {
  if (words instanceof ArrayBuffer) words = new Uint8Array(words);
  if (words instanceof Int8Array || words instanceof Uint16Array) words = new Uint8Array(words.buffer, words.byteOffset, words.byteLength);
  return kept.apply(this, arguments);
};
const pass = (o, n, a, b, c) => n === 0 ? globalThis.start.call(o) : n === 1 ? globalThis.start.call(o, a) : n === 2 ? globalThis.start.call(o, a, b) : globalThis.start.call(o, a, b, c);
let total = 0;
for (let k = 0; k < 4000; k++) { const o = pass({}, k % 4, [k], k & 7, "third"); total += o.count + (o.words === "none" ? 1 : o.words[0] & 3) + (typeof o.size === "number" ? o.size : 0); }
console.log(total);
for (const value of [new ArrayBuffer(2), new Int8Array([1, 2, 3]), new Uint16Array([258]), [4], undefined, null, 0, ""]) { const o = pass({}, 2, value, 5); console.log(o.words === "none" ? "none" : o.words.constructor.name + o.words.length, o.size, o.count); }
// The parameter's element is deleted, written through the object, fixed, or beyond what was passed. An apply of its own sees the object itself, and what it writes is the parameter's.
globalThis.list = function () { return Array.from(arguments, (x, k) => k in arguments ? String(x) : "_").join(); };
globalThis.changes = {
  deleted: function (a, b) { delete arguments[0]; a = "assigned"; return globalThis.list.apply(null, arguments); },
  written: function (a, b) { a = 1; arguments[0] = "written"; return globalThis.list.apply(null, arguments) + a; },
  fixed: function (a, b) { Object.defineProperty(arguments, 0, { value: "fixed", writable: false }); a = "assigned"; return globalThis.list.apply(null, arguments) + a; },
  short: function (a, b) { b = "assigned"; return globalThis.list.apply(null, arguments) + b; },
  length: function (a, b) { arguments.length = 1; a = 5; return globalThis.list.apply(null, arguments); },
  seen: function (a, b) { a = "before"; const answer = globalThis.own.apply(null, arguments); return answer + a + b; },
  twice: function (a, b) { const first = globalThis.list.apply(null, arguments); a = "between"; return first + globalThis.list.apply(null, arguments) + arguments[0]; },
  held: function (a, b) { const set = () => { a = "by closure"; }; set(); return globalThis.list.apply(null, arguments); },
};
globalThis.own = { apply(receiver, passed) { passed[0] = "by apply"; passed[1] = "second"; return passed.length; } };
for (const name of Object.keys(globalThis.changes)) console.log(name, globalThis.changes[name](), globalThis.changes[name]("x"), globalThis.changes[name]("x", "y"), globalThis.changes[name]("x", "y", "z", "u", "v", "w"));
