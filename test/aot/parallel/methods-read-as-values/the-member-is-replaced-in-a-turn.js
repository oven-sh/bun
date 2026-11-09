// the program lays another function under the name in a turn: until then the value is the first function, from then on the other
class Base { constructor(n) { this.n = n; } twice() { return this.n * 2; } label(a, b) { return "base" + this.n; } }
class Derived extends Base { own() { return this.n + 1; } }
function run(o, turns) { let said = ""; const first = Base.prototype.twice; for (let i = 0; i < turns; i++) { if (i === 3) Base.prototype.twice = function later() { return 0; }; const f = o.twice; said += f.name + (f === first) + (f === Base.prototype.twice) + " "; } return said; }
console.log(run(new Derived(1), 6));
