// as the library's streams do it: two tables of operators, each wrapped in a function of its own and laid on a constructor function that others stand below
function Base(n) { this.n = n; }
Base.prototype.twice = function twice() { return this.n * 2; };
Object.defineProperty(Base.prototype, "size", { get: function size() { return this.n + 100; }, set: function size(v) { this.n = v - 100; }, configurable: true });
function Mid(n) { Base.call(this, n); }
Object.setPrototypeOf(Mid.prototype, Base.prototype);
Mid.prototype.other = function other() { return -1; };
function Leaf(n) { Mid.call(this, n); }
Object.setPrototypeOf(Leaf.prototype, Mid.prototype);
Leaf.prototype.own = function own() { return this.n + 1; };
const first = { map(f) { return "map" + this.n; }, filter(f) { return "filter" + this.n; } };
const second = { some(f) { return "some" + this.n; }, twice() { return "laid" + this.n; } };
function layAll(operators) { const keys = Object.keys(operators); for (let i = 0; i < keys.length; i++) { const key = keys[i]; const op = operators[key]; const fn = function (...args) { if (new.target) throw new TypeError("no constructor"); return op.apply(this, args); }; Object.defineProperty(fn, "name", { __proto__: null, value: op.name }); Object.defineProperty(fn, "length", { __proto__: null, value: op.length }); Object.defineProperty(Mid.prototype, key, { __proto__: null, value: fn, enumerable: false, configurable: true, writable: true }); } }
layAll(first);
function run(o, turns) { let said = ""; for (let i = 0; i < turns; i++) { if (i === 3) layAll(second); said += o.twice() + o.map() + ","; } return said; }
console.log(run(new Leaf(1), 6));
