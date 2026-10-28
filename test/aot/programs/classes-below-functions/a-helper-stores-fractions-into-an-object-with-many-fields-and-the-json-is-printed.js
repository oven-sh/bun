const print = (text) => console.log(text);
function str(v) {
  if (v === "string")
    return '"' + v + '"';
  return "" + v;
}
function A(p, q) {
  this.f0 = 0.5;
  this.f1 = "s1";
  this.f2 = 2;
  this.f3 = 3.5;
  this.f4 = "s4";
  this.f5 = 5;
  this.f6 = 6.5;
  this.f7 = "s7";
  this.f8 = 8;
  this.f9 = 9.5;
  this.f10 = "s10";
  this.f11 = 11;
  this.f12 = 12.5;
  this.f13 = "s13";
  this.f14 = 14;
  this.f15 = 15.5;
  this.f16 = "s16";
  this.f17 = 17;
  this.f18 = 18.5;
  this.f19 = "s19";
  this.f20 = 20;
  this.f21 = 21.5;
  this.f22 = "s22";
  this.f23 = 23;
  this.f24 = 24.5;
  this.f25 = "s25";
  this.f26 = 26;
  this.f27 = 27.5;
  this.f28 = "s28";
  this.f29 = 29;
  this.f30 = 30.5;
  this.f31 = "s31";
  this.f32 = 32;
  this.f33 = 33.5;
  this.f34 = "s34";
  this.f35 = 35;
  this.f36 = 36.5;
  this.f37 = "s37";
  this.f38 = 38;
  this.f39 = 39.5;
  this.f40 = "s40";
  this.f41 = 41;
  this.f42 = 42.5;
  this.f43 = "s43";
  this.f44 = 44;
  this.f45 = 45.5;
  this.f46 = "s46";
  this.f47 = 47;
  this.f48 = 48.5;
  this.f49 = "s49";
  this.f50 = 50;
  this.f51 = 51.5;
  this.f52 = "s52";
  this.f53 = 53;
  this.f54 = 54.5;
  this.f55 = "s55";
  this.f56 = 56;
  this.f57 = 57.5;
  this.f58 = "s58";
  this.f59 = 59;
  this.f60 = 60.5;
  this.f61 = "s61";
  this.f62 = 62;
  this.f63 = 63.5;
  this.f64 = "s64";
  this.f65 = 65;
  this.f66 = 66.5;
  this.f67 = "s67";
  this.f68 = 68;
  this.f69 = 69.5;
  this.r = this.total();
}
A.prototype.total = function() {
  return this.f0 + this.f35 + this.f69;
};
var __extends = function() {
  var extendStatics = function(d, b) {
    return Object.setPrototypeOf(d, b);
  };
  return function(d, b) {
    extendStatics(d, b);
    function __() {
      this.constructor = d;
    }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __);
  };
}();
function _defineProperty(e, r, t) {
  e[r] = t;
  return e;
}
var B = function(_super) {
  __extends(B, _super);
  function B(p, q) {
    var _this = _super.call(this, p, q) || this;
    _defineProperty(_this, "g2", 2);
    _defineProperty(_this, "g3", 3.5);
    _defineProperty(_this, "g20", 20);
    _defineProperty(_this, "g21", 21.5);
    _defineProperty(_this, "g24", 24.5);
    return _this;
  }
  Object.defineProperty(B.prototype, "total", { value: function() {
    return this.f1 + "|" + this.f36 + "|" + this.f68 + "|" + this.g0;
  }, writable: !0, enumerable: !1, configurable: !0 });
  return B;
}(A);
function build(which) {
  return which ? new B(1, "two") : new A(1, "two");
}
try {
  const o = build(!0);
  print("o $.r: " + str(o.r));
  print(JSON.stringify(o).replace(/"f[0-9]+":[^,]+,/g, ""));
  print("o instanceof A: " + (o instanceof A));
  print("o has the prototype of A: " + (Object.getPrototypeOf(o) === A.prototype));
} catch (e) {
  print("o threw " + e.name);
}
