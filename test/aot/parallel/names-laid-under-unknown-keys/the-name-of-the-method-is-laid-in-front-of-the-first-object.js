// the loop lays the name of the method itself on the function between, in front of the first object
function Base(n) { this.n = n; }
Base.prototype.twice = function twice() { return this.n * 2; };
Object.defineProperty(Base.prototype, "size", { get: function size() { return this.n + 100; }, set: function size(v) { this.n = v - 100; }, configurable: true });
function Mid(n) { Base.call(this, n); }
Object.setPrototypeOf(Mid.prototype, Base.prototype);
Mid.prototype.other = function other() { return -1; };
function Leaf(n) { Mid.call(this, n); }
Object.setPrototypeOf(Leaf.prototype, Mid.prototype);
Leaf.prototype.own = function own() { return this.n + 1; };
const table = { map() { return "map" + this.n; }, twice() { return "laid" + this.n; } };
{ const keys = Object.keys(table); for (let k = 0; k < keys.length; k++) { const key = keys[k]; Object.defineProperty(Mid.prototype, key, { value: table[key], enumerable: false, configurable: true, writable: true }); } }
function run(o, turns) { let said = ""; for (let i = 0; i < turns; i++) { said += o.twice() + ","; } return said; }
console.log(run(new Leaf(1), 6));
