function put(e, r, t) { e[r] = t; return e; }
function A() { this.f0 = 0.5; }
function B() { var _this = A.call(this) || this; put(_this, "g2", 2); put(_this, "g3", 3.5); put(_this, "g20", 20); put(_this, "g21", 21.5); put(_this, "g24", 24.5); return _this; }
B.prototype = Object.create(A.prototype);
console.log(JSON.stringify(new B()));
