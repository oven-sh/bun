// Getters under names that the text does not spell, and getters that a helper defines, are expected at the reads of their object in loops.
// STATISTIC: GettersExpectedInLoops >= 1
let reads = 0, extra = 0;
const requires = {};
requires.d = (target, table) => { for (var key in table) if (!requires.o(target, key)) Object.defineProperty(target, key, { configurable: true, enumerable: true, get: table[key] }); };
requires.o = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function add(a, b) { return a + b; }
function twice(n) { return n * 2; }
const lib = {};
requires.d(lib, { add: () => add, twice: () => twice, half: () => n => n / 2 });
function define(target, name, getter) { Object.defineProperty(target, name, { configurable: true, enumerable: true, get: getter }); }
const point = { x: 3 };
define(point, "length", function () { return this.x * 2; });
define(point, "area", function () { return this.x * this.x; });
const named = { base: 5 };
for (const name of ["a", "b", "c"]) Object.defineProperty(named, name, { configurable: true, enumerable: true, get() { reads++; return this.base + name.length + extra; } });
function react(object, key, value) { Object.defineProperty(object, key, { configurable: true, enumerable: true, get() { return value; }, set(next) { value = next; } }); }
function observe(object) { const keys = Object.keys(object); for (let i = 0; i < keys.length; i++) react(object, keys[i], object[keys[i]]); return object; }
const state = observe({ left: 1, right: 2.5 });
function ofLib(turns) { let n = 0; for (let k = 0; k < turns; k++) n += lib.add(k & 7, 1) + lib.twice(k & 3); return n; }
function ofPoint(turns) { let n = 0; for (let k = 0; k < turns; k++) n += point.length + point.area; return n; }
function ofNamed(turns) { let n = 0; for (let k = 0; k < turns; k++) n += named.a + named.b + named.c; return n; }
function ofState(turns) { let n = 0; for (let k = 0; k < turns; k++) n += state.left + state.right; return n; }
function changed(turns) { let s = ""; for (let k = 0; k < turns; k++) { if (k === 7) define(point, "area", () => "late"); if (k === 9) Object.defineProperty(point, "area", { value: k, configurable: true }); if (k === 11) delete point.area; s += point.area + ","; } return s; }
console.log(ofLib(3), ofLib(500), ofPoint(3), ofPoint(500), ofNamed(3), ofNamed(500), reads, ofState(3), ofState(500));
state.left = 10; extra = 1; point.x = 1.5; named.base = "t";
console.log(ofLib(50), ofPoint(50), ofNamed(5), ofState(50), reads);
Object.defineProperty(lib, "add", { configurable: true, enumerable: true, get: () => (a, b) => a - b });
Object.defineProperty(state, "left", { value: 100, writable: true, configurable: true, enumerable: true });
console.log(ofLib(50), ofState(50), changed(14), ofPoint(2));
Object.defineProperty(lib, "twice", { get() { throw new RangeError("no twice"); } });
try { console.log(ofLib(5)); } catch (e) { console.log(e.name, e.message); }
console.log(Object.keys(lib).join(), Object.keys(point).join(), JSON.stringify(state), reads);
