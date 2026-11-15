// a setter above is stored through, and the loop lays a value that cannot be written under its name on the function between: strict code throws, in front of the first object
"use strict";
function Base(n) { this.n = n; }
Base.prototype.twice = function twice() { return this.n * 2; };
Object.defineProperty(Base.prototype, "size", { get: function size() { return this.n + 100; }, set: function size(v) { this.n = v - 100; }, configurable: true });
function Mid(n) { Base.call(this, n); }
Object.setPrototypeOf(Mid.prototype, Base.prototype);
Mid.prototype.other = function other() { return -1; };
function Leaf(n) { Mid.call(this, n); }
Object.setPrototypeOf(Leaf.prototype, Mid.prototype);
Leaf.prototype.own = function own() { return this.n + 1; };
const table = { map() { return "map" + this.n; }, size: 7 };
{ const keys = Object.keys(table); for (let k = 0; k < keys.length; k++) { const key = keys[k]; Object.defineProperty(Mid.prototype, key, { value: table[key], enumerable: false, configurable: true, writable: false }); } }
function run(o, turns) { let said = ""; for (let i = 0; i < turns; i++) { try { o.size = 100 + i; } catch (e) { said += e.constructor.name; } said += o.n + "/" + Object.keys(o).length + ","; } return said; }
console.log(run(new Leaf(1), 6));
