// What compilers for ES5 write for `class B extends A`: a helper links the prototype objects, the constructor keeps `this` in a variable.
var out = [];
function say() { out.push(Array.prototype.map.call(arguments, String).join(" ")); }

var link = (function () {
  var linkStatics = function (d, b) {
    linkStatics = Object.setPrototypeOf || ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) || function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
    return linkStatics(d, b);
  };
  return function (d, b) {
    if (typeof b !== "function" && b !== null) throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
    linkStatics(d, b);
    function Between() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : ((Between.prototype = b.prototype), new Between());
  };
})();

// The plain case, three levels, methods on each.
var A = (function () {
  function A(a) { this.a = a; }
  A.prototype.first = function () { return "A.first " + this.a; };
  A.prototype.both = function () { return "A.both"; };
  A.made = function () { return "made by " + this.name; };
  return A;
})();
var B = (function (_super) {
  link(B, _super);
  function B(a) { var _this = _super.call(this, a) || this; _this.b = 2; return _this; }
  B.prototype.both = function () { return "B.both > " + _super.prototype.both.call(this); };
  return B;
})(A);
var C = (function (_super) {
  link(C, _super);
  function C() { var _this = (_super !== null && _super.apply(this, arguments)) || this; _this.c = 3; return _this; }
  return C;
})(B);
function describe(v) {
  return [v.a, v.b, v.c, v instanceof A, v instanceof B, v instanceof C, v.constructor && v.constructor.name, Object.keys(v).join()].join(" ");
}
for (var i = 0; i < 3; i++) say(describe(new A(i)), "|", describe(new B(i)), "|", describe(new C(i)));
say(new C(1).first(), new C(1).both(), C.made(), B.made(), Object.getPrototypeOf(C) === B, Object.getPrototypeOf(C.prototype) === B.prototype);
say(Object.getOwnPropertyNames(B.prototype).join(), Object.prototype.propertyIsEnumerable.call(B.prototype, "constructor"));

// The parent returns an object of its own: the variable does not hold `this`.
var Other = (function () { function Other(x) { return { other: x, b: "kept?" }; } return Other; })();
var FromOther = (function (_super) {
  link(FromOther, _super);
  function FromOther(x) { var _this = _super.call(this, x) || this; _this.b = 2; return _this; }
  return FromOther;
})(Other);
var fromOther = new FromOther(7);
say(JSON.stringify(fromOther), fromOther instanceof FromOther, Object.getPrototypeOf(fromOther) === Object.prototype);

// The parent is null.
var Rootless = (function (_super) {
  link(Rootless, _super);
  function Rootless() { this.r = 1; }
  return Rootless;
})(null);
var rootless = new Rootless();
say(rootless.r, Object.getPrototypeOf(Rootless.prototype), "toString" in rootless, rootless instanceof Rootless);

// What is no function is refused.
try { link(function () {}, 5); } catch (error) { say(error instanceof TypeError, error.message); }

// A setter above takes the store that the constructor makes.
var WithSetter = (function () {
  function WithSetter() {}
  Object.defineProperty(WithSetter.prototype, "b", { set: function (v) { this.seen = v; }, get: function () { return "got"; }, configurable: true });
  return WithSetter;
})();
var BelowSetter = (function (_super) {
  link(BelowSetter, _super);
  function BelowSetter() { var _this = _super.call(this) || this; _this.b = 2; return _this; }
  return BelowSetter;
})(WithSetter);
say(JSON.stringify(new BelowSetter()), new BelowSetter().b, Object.keys(new BelowSetter()).join());

// A setter that arrives late, on the parent's prototype object, and leaves again.
function makeB(n) { var sum = ""; for (var i = 0; i < n; i++) { var v = new B(i); sum += v.a + ":" + v.b + ":" + Object.keys(v).join("") + " "; } return sum; }
say(makeB(3));
Object.defineProperty(A.prototype, "b", { set: function (v) { this.hidden = v * 10; }, configurable: true });
say(makeB(3));
delete A.prototype.b;
say(makeB(3));

// The prototype object is swapped later; objects made before keep theirs.
var before = new B(1);
var swapped = { both: function () { return "swapped"; }, extra: 1 };
B.prototype = swapped;
var after = new B(2);
say(before.both(), after.both(), before instanceof B, after instanceof B, after.extra, after.first, after.a, after.b);
say(describe(new C(5)), new C(5).both());

// The link is changed later.
var P = (function () { function P() { this.p = 1; } P.prototype.who = function () { return "P"; }; return P; })();
var Q = (function () { function Q() { this.q = 1; } Q.prototype.who = function () { return "Q"; }; return Q; })();
var D = (function (_super) { link(D, _super); function D() { var _this = _super.call(this) || this; _this.d = 1; return _this; } return D; })(P);
function whoIs(n) { var s = ""; for (var i = 0; i < n; i++) s += new D().who(); return s; }
say(whoIs(3));
Object.setPrototypeOf(D.prototype, Q.prototype);
say(whoIs(3), new D() instanceof P, new D() instanceof Q, JSON.stringify(new D()));

// The helper is called twice for one child.
var Twice = (function (_super) { link(Twice, _super); function Twice() { var _this = _super.call(this) || this; _this.t = 1; return _this; } return Twice; })(P);
say(new Twice().who(), new Twice() instanceof P);
link(Twice, Q);
say(new Twice().who(), new Twice() instanceof P, new Twice() instanceof Q, JSON.stringify(new Twice()), Object.getPrototypeOf(Twice) === Q);

// One text, several parents: the function around the class runs more than once.
function derive(_super, tag) {
  link(Derived, _super);
  function Derived() { var _this = _super.call(this) || this; _this.tag = tag; return _this; }
  return Derived;
}
var FromP = derive(P, "p"), FromQ = derive(Q, "q");
say(new FromP().who(), new FromQ().who(), JSON.stringify(new FromP()), JSON.stringify(new FromQ()), new FromP() instanceof Q, new FromQ() instanceof Q);

// A built-in above.
var MyError = (function (_super) {
  link(MyError, _super);
  function MyError(message) { var _this = _super.call(this, message) || this; _this.code = 42; return _this; }
  return MyError;
})(Error);
var myError = new MyError("text");
say(myError instanceof MyError, myError instanceof Error, myError.code, myError.message, Object.getPrototypeOf(myError) === Error.prototype);
var MyList = (function (_super) {
  link(MyList, _super);
  function MyList() { var _this = _super.apply(this, arguments) || this; _this.mine = true; return _this; }
  return MyList;
})(Array);
var myList = new MyList(1, 2, 3);
say(myList instanceof MyList, Array.isArray(myList), myList.length, myList.mine);

// new.target and Reflect.construct.
var Seen = (function () { function Seen() { this.target = new.target === undefined ? "none" : new.target.name; } return Seen; })();
var BelowSeen = (function (_super) { link(BelowSeen, _super); function BelowSeen() { var _this = _super.call(this) || this; _this.own = new.target && new.target.name; return _this; } return BelowSeen; })(Seen);
say(JSON.stringify(new BelowSeen()), JSON.stringify(new Seen()));
var reflected = Reflect.construct(BelowSeen, [], P);
say(JSON.stringify(reflected), reflected instanceof P, reflected instanceof BelowSeen, reflected.who());
var reflectedB = Reflect.construct(D, [], Q);
say(JSON.stringify(reflectedB), reflectedB.who(), reflectedB instanceof D);

// Called without `new`.
try { var plain = D.call({ given: 1 }); say(JSON.stringify(plain)); } catch (error) { say("threw", error.message); }

// `var self = this`, stores in a callback, and a variable that is stored again.
function Holder(v) { var self = this; self.v = v; [1, 2].forEach(function (n) { self["n" + n] = n; self.last = n; }); }
say(JSON.stringify(new Holder(9)));
function Moves(v) { var it = this; it.first = v; it = { elsewhere: true }; it.second = v; this.third = it.second; }
say(JSON.stringify(new Moves(4)));
function OrOther(o) { var it = o || this; it.mark = 1; }
var given = {}; var made = new OrOther(given);
say(JSON.stringify(given), JSON.stringify(made), JSON.stringify(new OrOther(null)));

// A function that shares the prototype object of another one.
function Real(x) { this.x = x; }
Real.prototype.get = function () { return this.x; };
function Same(x) { this.x = x * 2; }
Same.prototype = Real.prototype;
say(new Same(2).get(), new Same(2) instanceof Real, new Real(2) instanceof Same, new Same(1).constructor === Real);
Same.prototype.more = function () { return "more " + this.x; };
say(new Real(3).more(), new Same(3).more());

// The value of a function that is called where it is written, and its parameters.
var counted = 0;
var Once = (function (Base, n) { counted += n; function Once() { Base.call(this); this.once = n; } Once.prototype = Object.create(Base.prototype); return Once; })(P, 5);
say(JSON.stringify(new Once()), new Once().who(), counted);
var Named = (function again(Base, depth) { if (depth) return again(Q, depth - 1); function Named() { Base.call(this); } Named.prototype = Object.create(Base.prototype); return Named; })(P, 1);
say(JSON.stringify(new Named()), new Named().who());
var Early = (function (Base) { if (Base === P) return Q; function Early() {} return Early; })(P);
say(new Early().who());
var Stored = (function (Base) { Base = Q; function Stored() { Base.call(this); } Stored.prototype = Object.create(Base.prototype); return Stored; })(P);
say(JSON.stringify(new Stored()), new Stored().who());
var Spread = (function (First, Base) { function Spread() { Base.call(this); } Spread.prototype = Object.create(Base.prototype); return Spread; })(...[P, Q]);
say(JSON.stringify(new Spread()), new Spread().who());
var ByArguments = (function (Base) { arguments[0] = Q; function ByArguments() { Base.call(this); } ByArguments.prototype = Object.create(Base.prototype); return ByArguments; })(P);
say(JSON.stringify(new ByArguments()), new ByArguments().who());

console.log(out.join("\n"));
