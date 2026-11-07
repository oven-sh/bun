// Inheritance as it was written before there were classes: each constructor calls the one above it on `this`, and finds it by reading a property, as `http.ServerResponse.call(this, req)` does.
// What the objects have and in which order, whatever stands on the prototype chain. Only the jsc shell can count. Elsewhere the program checks the answers alone.
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
// Env: JSC_aotCountsPath=/dev/null
const countsSoFar = () => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
// The calls in such a text, whatever they were for, but for the operations named, and but for the calls that found an allocator without a cell at hand and filled it again: a line "<calls>\trefilled:<name>".
// How often that is goes by the size of the cells, which is not the same on every machine.
function callsIn(counts, ...besides) {
  let sum = 0;
  for (const line of counts.split("\n")) {
    const [calls, name] = line.split("\toperation:");
    if (name !== undefined && !besides.includes(name)) sum += Number(calls);
    const [refills, refilled] = line.split("\trefilled:");
    if (refilled !== undefined && !besides.includes(refilled)) sum -= Number(refills);
  }
  return sum;
}
// These make the text that is printed, list the names for it and keep it in a set; a cell where the allocator has none at hand is the work of the run time.
const owed = ["operationAOTArrayJoin", "operationAOTConcat", "operationAOTOwnPropertyKeys", "operationAOTSetAdd", "operationAOTStackStringBuilderAppend", "operationAOTStackStringBuilderFinish", "operationAOTStringOfAnyValue", "operationAOTAllocateSlow"];
const kState = Symbol("kState");
const kBytes = Symbol("kBytes");
const kSocket = Symbol("kSocket");
const kHeaders = Symbol("kHeaders");
const kErrored = Symbol("kErrored");
// Two functions are stored under each name: nobody can tell from the text which one a call reaches.
const library = { Emitter: function Unused() {}, Message: function Unused() {}, Response: function Unused() {} };
library.Emitter = function Emitter() {
  this.events = null;
  this.eventsCount = 0;
  this.maxListeners = undefined;
};
library.Message = function Message(options) {
  library.Emitter.call(this);
  this.outputData = [];
  this.outputSize = 0;
  this.destroyed = false;
  this.last = false;
  this[kState] = 0;
  this.sendDate = false;
  this.removedConnection = false;
  this.removedLength = false;
  this[kBytes] = 0;
  this.contentLength = null;
  this.hasBody = true;
  this.trailer = "";
  this[kSocket] = null;
  this.finished = false;
  this.headerSent = false;
  this[kHeaders] = null;
  this.closed = false;
  this.header = null;
  this.timeout = 0;
  this[kErrored] = null;
  this.options = options;
};
Object.setPrototypeOf(library.Message.prototype, library.Emitter.prototype);
library.Response = function Response(request) {
  library.Message.call(this, "none");
  this.request = request;
  this.statusCode = 200;
  this.statusMessage = undefined;
};
Object.setPrototypeOf(library.Response.prototype, library.Message.prototype);
function Injected(request) {
  library.Response.call(this, request);
  this.injected = true;
}
Object.setPrototypeOf(Injected.prototype, library.Response.prototype);
function describe(object) {
  return Reflect.ownKeys(object).map(key => String(key) + "=" + String(object[key])).join(" ");
}

const said = new Set();
const before = countsSoFar();
for (let i = 0; i < 3000; i++) said.add(describe(new Injected("r")));
const grown = callsIn(countsSoFar(), ...owed) - callsIn(before, ...owed);
console.log([...said].join("\n"));
console.log(grown <= 300 ? "the object had room for what the constructors above give it" : "the storage of " + grown + " objects had to grow");

// Nothing of the program runs while room is made: no getter of `constructor`, no trap of a Proxy.
const log = [];
function Watched() {
  library.Message.call(this, "watched");
  this.own = 1;
}
Object.setPrototypeOf(Watched.prototype, library.Message.prototype);
Object.defineProperty(Watched.prototype, "constructor", { get() { log.push("constructor was read"); return Watched; }, configurable: true });
console.log(describe(new Watched()) === describe(new Watched()), log.length);
function BehindProxy() {
  this.a = 1;
  this.b = 2;
  this.c = 3;
}
BehindProxy.prototype = new Proxy({}, {
  get(target, key) { log.push("get " + String(key)); return target[key]; },
  getPrototypeOf(target) { log.push("getPrototypeOf"); return Reflect.getPrototypeOf(target); },
  getOwnPropertyDescriptor(target, key) { log.push("getOwnPropertyDescriptor " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); },
  set(target, key, value, receiver) { log.push("set " + String(key)); return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true }); },
});
console.log(Object.keys(new BehindProxy()).join(), log.join());

// A `constructor` that is no function of the program, one that names its own object twice, a chain that ends at null, a chain that is moved later.
function Odd() {
  this.x = 1;
  this.y = 2;
  this.z = 3;
}
Odd.prototype = Object.create(Object.create(null, { constructor: { value: Array } }), { constructor: { value: 7 } });
console.log(describe(new Odd()), Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(new Odd()))));
function Loop() {
  library.Emitter.call(this);
  this.loop = true;
}
Loop.prototype = Object.create(Object.create(library.Emitter.prototype, { constructor: { value: Loop } }), { constructor: { value: Loop } });
console.log(describe(new Loop()));
function Moved() {
  this.first = 1;
  this.parent.call(this, "moved");
}
Moved.prototype.parent = library.Emitter;
Object.setPrototypeOf(Moved.prototype, library.Emitter.prototype);
console.log(describe(new Moved()));
Moved.prototype.parent = library.Message;
Object.setPrototypeOf(Moved.prototype, library.Message.prototype);
console.log(describe(new Moved()));

// Another new.target: the object inherits from its `prototype` and is filled by the constructor that was called.
function Target() {}
Target.prototype = { named: "target" };
const constructed = Reflect.construct(Injected, ["c"], Target);
console.log(describe(constructed), constructed.named, constructed instanceof Injected);

// More names than an object holds in itself.
const wide = {};
wide.Base = function Base() {
  for (let i = 0; i < 40; i++) this["base" + i] = i;
  this.b0 = 0; this.b1 = 1; this.b2 = 2; this.b3 = 3; this.b4 = 4; this.b5 = 5; this.b6 = 6; this.b7 = 7; this.b8 = 8; this.b9 = 9;
  this.b10 = 10; this.b11 = 11; this.b12 = 12; this.b13 = 13; this.b14 = 14; this.b15 = 15; this.b16 = 16; this.b17 = 17; this.b18 = 18; this.b19 = 19;
  this.b20 = 20; this.b21 = 21; this.b22 = 22; this.b23 = 23; this.b24 = 24; this.b25 = 25; this.b26 = 26; this.b27 = 27; this.b28 = 28; this.b29 = 29;
  this.b30 = 30; this.b31 = 31; this.b32 = 32; this.b33 = 33; this.b34 = 34; this.b35 = 35; this.b36 = 36; this.b37 = 37; this.b38 = 38; this.b39 = 39;
};
wide.Derived = function Derived() {
  wide.Base.call(this);
  this.d0 = 0; this.d1 = 1; this.d2 = 2; this.d3 = 3; this.d4 = 4; this.d5 = 5; this.d6 = 6; this.d7 = 7; this.d8 = 8; this.d9 = 9;
  this.d10 = 10; this.d11 = 11; this.d12 = 12; this.d13 = 13; this.d14 = 14; this.d15 = 15; this.d16 = 16; this.d17 = 17; this.d18 = 18; this.d19 = 19;
  this.d20 = 20; this.d21 = 21; this.d22 = 22; this.d23 = 23; this.d24 = 24; this.d25 = 25; this.d26 = 26; this.d27 = 27; this.d28 = 28; this.d29 = 29;
};
Object.setPrototypeOf(wide.Derived.prototype, wide.Base.prototype);
let sum = 0;
let keys = "";
for (let i = 0; i < 200; i++) {
  const object = new wide.Derived();
  keys = Object.keys(object).join();
  for (const key in object) sum += object[key];
}
console.log(keys.length, keys.slice(-40), sum);
