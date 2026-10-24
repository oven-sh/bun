// `Object.prototype.toString.call(value)`, written out and through a variable: what the engine remembers for the shape of an object is read in place. Whatever changes the answer for a shape is seen at once.
var toString = Object.prototype.toString;
function tagOf(value) { return toString.call(value); }
function tagWrittenOut(value) { return Object.prototype.toString.call(value); }
class Point { constructor() { this.x = 1; } }
class Tagged { get [Symbol.toStringTag]() { Tagged.reads++; return "Tagged" + Tagged.reads; } }
Tagged.reads = 0;
function Old() { this.y = 2; }
var plain = { a: 1 }, withTag = { [Symbol.toStringTag]: "Own" }, inherits = Object.create(withTag), bare = Object.create(null), point = new Point(), old = new Old(), tagged = new Tagged();
var values = [undefined, null, true, 1, 1.5, "s", Symbol.iterator, 1n, plain, withTag, inherits, bare, point, old, tagged, [], function () {}, class {}, /x/, new Date(0), new Error("e"), new Map(), new Set(), new WeakMap(), Promise.resolve(), new Uint8Array(1), new ArrayBuffer(1), new DataView(new ArrayBuffer(1)), (function () { return arguments; })(), new Proxy([], {}), new Proxy({}, {}), new Proxy(function () {}, {}), Math, JSON, new Boolean(true), new Number(1), new String("s"), Object(Symbol.iterator), Object(1n), (function* () {})(), async function () {}];
function all(f) { return values.map(f).join(); }
for (var round = 0; round < 3; round++) console.log(all(tagOf) === all(tagWrittenOut), all(tagOf));
Point.prototype[Symbol.toStringTag] = "Point";
console.log(tagOf(point), tagOf(new Point()), tagWrittenOut(point));
delete Point.prototype[Symbol.toStringTag];
console.log(tagOf(point), tagWrittenOut(point));
Old.prototype[Symbol.toStringTag] = "Everything";
console.log(tagOf(plain), tagOf(old), tagOf(new Old()), tagOf(bare), tagOf(withTag), tagWrittenOut(point));
delete Old.prototype[Symbol.toStringTag];
console.log(tagOf(plain), tagOf(old), tagOf(new Old()), tagOf(bare));
plain[Symbol.toStringTag] = "Later";
console.log(tagOf(plain), tagOf({ a: 1 }));
Object.setPrototypeOf(old, withTag);
console.log(tagOf(old), tagOf(new Old()));
withTag[Symbol.toStringTag] = 5;
console.log(tagOf(withTag), tagOf(inherits), tagOf(old));
console.log(tagOf(tagged), tagOf(tagged), Tagged.reads);
toString = function () { return "mine " + typeof this; };
console.log(tagOf(plain), tagOf(1), tagWrittenOut(plain));
