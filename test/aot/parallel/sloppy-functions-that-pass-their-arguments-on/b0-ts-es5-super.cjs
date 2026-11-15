var __extends = (this && this.__extends) || (function () { var e = function (d, b) { e = Object.setPrototypeOf || function (d, b) { d.__proto__ = b; }; return e(d, b); }; return function (d, b) { e(d, b); function __() { this.constructor = d; } d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __()); }; })();
var A = (function () { function A(x) { this.x = x; } A.prototype.v = function () { return this.x; }; return A; }());
var C = (function (_super) { __extends(C, _super); function C() { return _super !== null && _super.apply(this, arguments) || this; } return C; }(A));
function h(x) { return new C(x).v(); }
function f(t) { var s = 0; for (var i = 0; i < 64; i++) s += h(i + t); return s; }
const n = 50; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
