// a class between the receiver and the method gets the name in a turn: from then on the value is the nearer function
class Base { constructor(n) { this.n = n; } twice() { return this.n * 2; } label(a, b) { return "base" + this.n; } }
class Derived extends Base { own() { return this.n + 1; } }
function run(o, turns) { let said = ""; for (let i = 0; i < turns; i++) { if (i === 3) Derived.prototype.twice = function nearer() { return 0; }; const f = o.twice; said += f.name + (f === Base.prototype.twice) + " "; } return said; }
console.log(run(new Derived(1), 6));
