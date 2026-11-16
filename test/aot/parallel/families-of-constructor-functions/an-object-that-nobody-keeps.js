// Nobody keeps the object that one() makes: the methods are copied and do not touch it, and the store goes with it. two() holds a copy of one() that is left for a call where its look fails, so the object may never be made there.
// Unseen text has laid a setter under `extra` and another function under `step` ahead of the first Counter. later() asks the family first and makes its Counter ahead of that test.
function Counter() { }
Counter.prototype.step = function () { return 1; };
Counter.prototype.size = function () { return 2; };
function Gauge() { }
Gauge.prototype.step = function () { return 1; };
Gauge.prototype.size = function () { return 2; };
function one(n) { var made = new Counter(); made.extra = n; return made.step() + made.size(); }
function two(n) { return one(n) + 1; }
function both(made, other, n) { other.extra = n; var sum = other.step() + other.size(); made.extra = n; return sum + made.step() + made.size(); }
function later(other, n) { return both(new Counter(), other, n); }
globalThis.hits = 0;
globalThis.classes = { Counter, Gauge };
globalThis.hook = later;
const change = (text) => (0, eval)(text);
change("Object.defineProperty(classes.Counter.prototype, 'extra', { set(value) { hits++; }, configurable: true }); classes.Counter.prototype.step = function () { return 5; };");
const gauge = new Gauge();
let sum = later(gauge, 1);
if (process.argv.length > 7) sum += later(new Counter(), 1);
sum += globalThis.hook(gauge, 2);
console.log(two(1), two(2), one(3), sum, globalThis.hits);
