// a method that a statement lays on the prototype of a constructor function, read as a value off its own objects and off those of a function below
function F(n) { this.n = n; }
F.prototype.m = function m() { return this.n; };
function K(n) { F.call(this, n); }
Object.setPrototypeOf(K.prototype, F.prototype);
function run(a, b, turns) { let said = ""; for (let i = 0; i < turns; i++) { const f = a.m, g = b.m; said = "" + (f === F.prototype.m) + (g === f) + f.name + g.call({ n: 3 }); } return said; }
console.log(run(new F(1), new K(2), 5));
