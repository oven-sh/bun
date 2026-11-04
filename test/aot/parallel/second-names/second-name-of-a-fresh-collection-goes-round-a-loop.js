// Maps, Sets, typed arrays, regular expressions, dates and instances of classes that are made here and get a second name in the head of a loop.
function ofMap(n) { const made = new Map(); let k = made; for (let i = 0; i < n; i++) { k.set(i, i * 2); k = k; } return made.size + ":" + made.get(n - 1) + ":" + made.has(0); }
function ofFilledMap(n) { const made = new Map([["a", 1]]); let k = made; for (let i = 0; i < n; i++) { k.delete("a"); k.set("b", i); k = k; } return made.size + ":" + made.get("a") + ":" + made.get("b"); }
function ofSet(n) { const made = new Set(); let k = made; for (let i = 0; i < n; i++) { k.add(i & 1); k = k; } return made.size + ":" + made.has(1); }
function ofBytes(n) { const made = new Uint8Array(4); let k = made; for (let i = 0; i < n; i++) { k[1] += i; k = k; } return made[1]; }
function ofDoubles(n) { const made = new Float64Array(2); let k = made; for (let i = 0; i < n; i++) { k[0] += 0.5; k = k; } return made[0]; }
function ofRegExp(n) { const made = /a/g; let k = made; for (let i = 0; i < n; i++) { k.lastIndex = i; k = k; } return made.lastIndex; }
function ofRegExpRun(n) { const made = /a/g; let k = made; for (let i = 0; i < n; i++) { k.test("aaaaaaaaaa"); k = k; } return made.lastIndex; }
function ofDate(n) { const made = new Date(0); let k = made; for (let i = 0; i < n; i++) { k.setTime(k.getTime() + i); k = k; } return made.getTime(); }
class Point { x = 0; #hidden = 0; bump(v) { this.#hidden += v; this.x += 1; } get hidden() { return this.#hidden; } }
function ofInstance(n) { const made = new Point(); let k = made; for (let i = 0; i < n; i++) { k.bump(i); k = k; } return made.x + ":" + made.hidden; }
function ofInstanceField(n) { const made = new Point(); let k = made; for (let i = 0; i < n; i++) { k.x += i; k = k; } return made.x; }
function ofArguments(n) { const made = (function () { return arguments; })(0, 1); let k = made; for (let i = 0; i < n; i++) { k[0] += i; k = k; } return made[0]; }
function ofOwnArguments(n, v) { let k = arguments; for (let i = 0; i < n; i++) { k[1] = i; k = k; } return arguments[1]; }
function ofError(n) { const made = new Error("first"); let k = made; for (let i = 0; i < n; i++) { k.message = "turn " + i; k = k; } return made.message; }
function ofNullObject(n) { const made = Object.create(null); made.n = 0; let k = made; for (let i = 0; i < n; i++) { k.n += i; k = k; } return made.n; }
function ofSpread(n) { const from = { n: 0 }; const made = { ...from }; let k = made; for (let i = 0; i < n; i++) { k.n += i; k = k; } return made.n + ":" + from.n; }
console.log(ofMap(0), ofMap(6), ofFilledMap(0), ofFilledMap(6), ofSet(0), ofSet(6));
console.log(ofBytes(0), ofBytes(6), ofDoubles(0), ofDoubles(6), ofRegExp(0), ofRegExp(6), ofRegExpRun(0), ofRegExpRun(6), ofDate(0), ofDate(6));
console.log(ofInstance(0), ofInstance(6), ofInstanceField(0), ofInstanceField(6), ofArguments(0), ofArguments(6), ofOwnArguments(0, 9), ofOwnArguments(6, 9));
console.log(ofError(0), ofError(6), ofNullObject(0), ofNullObject(6), ofSpread(0), ofSpread(6));
let last = ""; for (let r = 0; r < 300; r++) last = [ofMap(6), ofFilledMap(6), ofSet(6), ofBytes(6), ofDoubles(6), ofRegExp(6), ofRegExpRun(6), ofDate(6), ofInstance(6), ofInstanceField(6), ofArguments(6), ofOwnArguments(6, 9), ofError(6), ofNullObject(6), ofSpread(6)].join(" ");
console.log(last);
