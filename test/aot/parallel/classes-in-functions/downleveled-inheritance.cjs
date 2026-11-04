var __extends = function (d, b) { Object.setPrototypeOf(d, b); function __() { this.constructor = d; } d.prototype = (__.prototype = b.prototype, new __()); };
var Base = (function () { function Base(a) { this.a = a; } Base.prototype.first = function () { return this.a; }; return Base; })();
var Below = (function (_super) { __extends(Below, _super); function Below(a, b) { var _this = _super.call(this, a) || this; _this.b = b; return _this; } Below.prototype.second = function () { return this.b + this.first(); }; return Below; })(Base);
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new Below(i, 2).second(); return t; }
console.log(run(4), new Below(1, 2) instanceof Base, Object.keys(new Below(1, 2)).join());
