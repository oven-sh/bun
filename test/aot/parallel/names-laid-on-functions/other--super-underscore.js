function Base(a) { this.a = a; }
function Below(a) { Below.super_.call(this, a); }
Below.super_ = Base;
Object.setPrototypeOf(Below.prototype, Base.prototype);
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new Below(i).a; return t; }
console.log(run(5)); Below.super_ = function (a) { this.a = a + 100; }; console.log(run(5));
