function Base(a) { this.a = a; }
Base.prototype.first = function () { return this.a; };
function Below(a, b) { Base.call(this, a); this.b = b; }
Below.prototype = Object.create(Base.prototype);
Below.prototype.constructor = Below;
Below.prototype.second = function () { return this.b + this.first(); };
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new Below(i, 2).second() + new Base(i).first(); return t; }
console.log(run(4), new Below(1, 2) instanceof Base);
