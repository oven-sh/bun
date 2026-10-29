// `Parent.call(this, ..)` and `Parent.apply(this, arguments)` where the parent holds names of its own, stands below another function, or hides `call` itself.
const lines = [];
function show(label, make) {
  let text;
  try {
    text = JSON.stringify(make());
  } catch (error) {
    text = error.constructor.name + ": " + error.message.split(" (In")[0];
  }
  lines.push(label + " " + text);
}

function WithStatic(a) { this.a = a; }
WithStatic.limit = 10;
function BelowWithStatic(a) { WithStatic.call(this, a); this.b = 2; }
show("a static", () => new BelowWithStatic(1));
function AppliesWithStatic() { WithStatic.apply(this, arguments); this.b = 3; }
show("a static, apply", () => new AppliesWithStatic(4));

function HidesCall(a) { this.a = a; }
HidesCall.call = function (self, a) { self.hidden = a; };
function BelowHidesCall(a) { HidesCall.call(this, a); }
show("call of its own", () => new BelowHidesCall(5));

function HidesApply(a) { this.a = a; }
HidesApply.apply = function (self, list) { self.hidden = list.length; };
function BelowHidesApply() { HidesApply.apply(this, arguments); }
show("apply of its own", () => new BelowHidesApply(6, 7));

function HidesLater(a) { this.a = a; }
HidesLater.other = 1;
function BelowHidesLater(a) { HidesLater.call(this, a); }
show("before it hides call", () => new BelowHidesLater(8));
HidesLater.call = function (self, a) { self.later = a; };
show("after it hides call", () => new BelowHidesLater(9));
delete HidesLater.call;
show("after the delete", () => new BelowHidesLater(10));

function HidesByKey(a) { this.a = a; }
const names = ["limit", "call"];
for (const name of names) HidesByKey[name] = function (self, a) { self.byKey = a; };
function BelowHidesByKey(a) { HidesByKey.call(this, a); }
show("call stored under a computed key", () => new BelowHidesByKey(11));

function HidesByDefinition(a) { this.a = a; }
Object.defineProperty(HidesByDefinition, "call", { get() { return function (self, a) { self.defined = a; }; } });
function BelowHidesByDefinition(a) { HidesByDefinition.call(this, a); }
show("call defined as a getter", () => new BelowHidesByDefinition(12));

function HidesByAssign(a) { this.a = a; }
Object.assign(HidesByAssign, { call(self, a) { self.assigned = a; } });
function BelowHidesByAssign(a) { HidesByAssign.call(this, a); }
show("call copied from a literal", () => new BelowHidesByAssign(13));

function Top(a) { this.top = a; }
function Middle(a) { Top.call(this, a); this.middle = a + 1; }
Object.setPrototypeOf(Middle, Top);
function Bottom(a) { Middle.call(this, a); this.bottom = a + 2; }
Object.setPrototypeOf(Bottom, Middle);
function Last(a) { Bottom.call(this, a); }
show("below two functions", () => new Last(14));
Top.limit = 1;
show("the top one gets a static", () => new Last(15));
Top.call = function (self, a) { self.fromTop = a; };
show("the top one hides call", () => new Last(16));
delete Top.call;
show("and shows it again", () => new Last(17));

function UnderObject(a) { this.a = a; }
Object.setPrototypeOf(UnderObject, { call(self, a) { self.fromObject = a; } });
function BelowUnderObject(a) { UnderObject.call(this, a); }
show("below an object that has call", () => new BelowUnderObject(18));

function UnderNothing(a) { this.a = a; }
Object.setPrototypeOf(UnderNothing, null);
function BelowUnderNothing(a) { UnderNothing.call(this, a); }
show("below nothing", () => new BelowUnderNothing(19));

function UnderLater(a) { this.a = a; }
UnderLater.limit = 2;
function BelowUnderLater(a) { UnderLater.call(this, a); }
show("before it goes below nothing", () => new BelowUnderLater(20));
Object.setPrototypeOf(UnderLater, null);
show("after", () => new BelowUnderLater(21));

function UnderProto(a) { this.a = a; }
function Lender(a) { this.lender = a; }
Lender.call = function (self, a) { self.lent = a; };
UnderProto.__proto__ = Lender;
function BelowUnderProto(a) { UnderProto.call(this, a); }
show("below a function that hides call, by __proto__", () => new BelowUnderProto(22));

class Base { constructor(a) { this.a = a; } static call(self, a) { self.fromClass = a; } }
function UnderClass(a) { this.a = a; }
Object.setPrototypeOf(UnderClass, Base);
function BelowUnderClass(a) { UnderClass.call(this, a); }
show("below a class with a static call", () => new BelowUnderClass(23));

function Bound(a) { this.a = a; return this; }
Bound.limit = 3;
Object.setPrototypeOf(Bound, Top);
const bound = Bound.bind({ held: 1 }, 24);
show("bound", () => [bound(), Object.getPrototypeOf(bound) === Top, bound.name, bound.length]);
show("has instance", () => [new Last(1) instanceof Last, Function.prototype[Symbol.hasInstance].call(Bottom, new Bottom(1)), typeof Bottom.toString()]);

function Shared(d, b) { Object.setPrototypeOf(d, b); }
function P(a) { this.p = a; }
function Q(a) { P.call(this, a); this.q = a; }
function R(a) { Q.call(this, a); this.r = a; }
function S(a) { R.call(this, a); this.s = a; }
Shared(Q, P);
Shared(R, Q);
Shared(S, R);
show("linked by a helper", () => new S(25));
Q.call = function (self, a) { self.stopped = a; };
show("one in the middle hides call", () => new S(26));

function DefinesOther(a) { this.a = a; }
Object.defineProperty(DefinesOther, "super_", { value: Top, writable: true, configurable: true });
function BelowDefinesOther(a) { DefinesOther.call(this, a); }
show("another name defined", () => new BelowDefinesOther(27));

function DefinedByKey(a) { this.a = a; }
Object.defineProperty(DefinedByKey, names[1], { value(self, a) { self.definedByKey = a; } });
function BelowDefinedByKey(a) { DefinedByKey.call(this, a); }
show("call defined under a computed key", () => new BelowDefinedByKey(28));

function DefinedByMap(a) { this.a = a; }
Object.defineProperties(DefinedByMap, { limit: { value: 1 }, call: { value(self, a) { self.definedByMap = a; } } });
function BelowDefinedByMap(a) { DefinedByMap.call(this, a); }
show("call defined by a map", () => new BelowDefinedByMap(29));

function DefinedByReflect(a) { this.a = a; }
Reflect.defineProperty(DefinedByReflect, "apply", { value(self, list) { self.definedByReflect = list[0]; } });
function BelowDefinedByReflect() { DefinedByReflect.apply(this, arguments); }
show("apply defined by Reflect", () => new BelowDefinedByReflect(30));

function DefinedAbove(a) { this.a = a; }
function Above() {}
Above();
Object.setPrototypeOf(DefinedAbove, Above);
function BelowDefinedAbove(a) { DefinedAbove.call(this, a); }
show("before the function above defines call", () => new BelowDefinedAbove(31));
Object.defineProperty(Above, "call", { configurable: true, value(self, a) { self.definedAbove = a; } });
show("after", () => new BelowDefinedAbove(32));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += new BelowWithStatic(i & 7).a + new Last(i & 3).top + new AppliesWithStatic(i & 1).a;
lines.push("sum " + sum);
console.log(lines.join("\n"));
