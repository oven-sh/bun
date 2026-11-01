// The form that TypeScript and Babel write for a class compiled to ES5, with _defineProperty for its fields. A validating build once gave every later double the first one's value.
function put(e, r, t) { e[r] = t; return e; }
function A() { this.f0 = 0.5; }
function B() { var _this = A.call(this) || this; put(_this, "g2", 2); put(_this, "g3", 3.5); put(_this, "g20", 20); put(_this, "g21", 21.5); put(_this, "g24", 24.5); return _this; }
B.prototype = Object.create(A.prototype);
console.log(JSON.stringify(new B()));
