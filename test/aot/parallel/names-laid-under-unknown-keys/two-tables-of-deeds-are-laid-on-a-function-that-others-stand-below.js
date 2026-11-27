// Two tables of functions, each wrapped in a function of its own, are laid on a constructor function that others stand below.
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
function layAll(deeds) { for (const name in deeds) { const deed = deeds[name]; Object.defineProperty(Mid.prototype, name, { value(...given) { return "lent " + deed.apply(this, given); }, writable: true, enumerable: false, configurable: true }); } }
layAll(first);
function run(o, turns) { let said = ""; for (let i = 0; i < turns; i++) { if (i === 3) layAll(second); said += o.twice() + o.map() + ","; } return said; }
console.log(run(new Leaf(1), 6));
