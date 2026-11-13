// The getters of a module's exports are found once before a loop that changes nothing they depend on: in exports that a variable of the module holds and no layout tells apart.
// STATISTIC: GettersExpectedInLoops >= 1
// STATISTIC: SiteCachedReadsHoisted >= 1
const lines = [];
var webpack = {};
webpack.d = (exports, definition) => {
  for (var key in definition) if (webpack.o(definition, key) && !webpack.o(exports, key)) Object.defineProperty(exports, key, { enumerable: true, configurable: true, get: definition[key] });
};
webpack.o = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
var lib = {};
webpack.d(lib, { add: () => add, twice: () => twice, scale: () => scale, limit: () => limit });
function add(a, b) { return a + b; }
function twice(n) { return n * 2; }
let scale = n => n * 3;
let limit = 5;
const listed = {};
for (const [name, get] of Object.entries({ half: () => n => n / 2 })) Object.defineProperty(listed, name, { enumerable: true, configurable: true, get });
Object.defineProperty(listed, "add", { enumerable: true, configurable: true, get: () => add });
Object.defineProperty(listed, "twice", { enumerable: true, configurable: true, get: function () { return twice; } });
function ofLib(turns) { let n = 0; for (let k = 0; k < turns; k++) n += lib.add(k & 7, 1) + lib.twice(k & 3) + lib.scale(k & 1); return n; }
function ofOne(turns) { let n = 0; for (let k = 0; k < turns; k++) n += lib.add(k & 7, 1); return n; }
function ofLimit(turns) { let n = 0; for (let k = 0; k < turns; k++) if (k < lib.limit) n += k; return n; }
function ofListed(turns) { let n = 0; for (let k = 0; k < turns; k++) n += listed.add(k & 7, 1) + listed.twice(listed.twice(k & 7)) + listed.half(k & 6); return n; }
function changedInside(turns) { let s = ""; for (let k = 0; k < turns; k++) { if (k === 3) limit = k; if (k === 5) scale = n => n - 1; if (k === 7) lib = { scale: n => -n, limit: 0 }; s += lib.scale(k) + ":" + lib.limit + ","; } return s; }
function changedByCallee(turns) { let n = 0; for (let k = 0; k < turns; k++) n += lib.add(k, 1); return n; }
lines.push(ofLib(2), ofLib(300), ofOne(1), ofOne(300), ofLimit(300), ofListed(2), ofListed(300));
scale = n => n * 0.5;
limit = 7.5;
lines.push(ofLib(300), ofLimit(300));
const first = lib;
lines.push(changedInside(10), limit);
lib = first;
let calls = 0;
Object.defineProperty(lib, "add", { configurable: true, get: () => (a, b) => { if (++calls === 20) Object.defineProperty(lib, "add", { configurable: true, get: () => (a, b) => a * 100 + b }); return a; } });
lines.push(changedByCallee(40), calls, ofLib(10), ofOne(10));
delete lib.twice;
try { lines.push(ofLib(3)); } catch (e) { lines.push(e.name); }
Object.defineProperty(listed, "half", { get() { throw new RangeError("no half"); } });
try { lines.push(ofListed(3)); } catch (e) { lines.push(e.name + " " + e.message); }
Object.setPrototypeOf(lib, { twice: n => n + 1000 });
lines.push(ofLib(3), Object.keys(lib).join());
console.log(lines.join("\n"));
