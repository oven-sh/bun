// Under: --aot-testing=FailSpeculations: every guess fails: the arm behind the test of new.target is built as written too
// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the fields that the births fill is asked again at run time
// `new.target === C` in C's own body: behind it `this` is what C's own allocation made. Each block is a way to come into the body: by new, by an heir, by Reflect.construct with either function, bound, through a proxy, by a plain call, with the prototype replaced, out of two closures of one function.
function tell(made) {
  return [made.how, made.a, Object.keys(made).join("+"), Object.getPrototypeOf(made) === Base.prototype ? "Base" : Object.getPrototypeOf(made) === Below.prototype ? "Below" : "other"].join(" ");
}
function Base(a) {
  if (new.target === Base) {
    this.how = "own";
    this.a = a;
    this.b = 1;
    this.c = "c";
    this.d = null;
    this.e = 2.5;
  } else {
    this.how = new.target === undefined ? "called" : "below";
    this.a = a;
  }
}
class Below extends Base {
  constructor(a) { super(a); this.own = "own"; this.more = a + 1; }
}
globalThis.madeUpBase = Base;
globalThis.madeUpBelow = Below;
console.log(tell(new Base(1)), "|", tell(new Below(2)));
console.log(tell(Reflect.construct(Base, [3], Base)), "|", tell(Reflect.construct(Base, [4], Below)), "|", tell(Reflect.construct(Below, [5], Base)));
const Bound = Base.bind(null, 6);
console.log(tell(new Bound()), "|", tell(Reflect.construct(Bound, [], Below)));
const Through = new Proxy(Base, {});
console.log(tell(new Through(7)), "|", tell(Reflect.construct(Through, [8], Base)));
const plain = { plain: true };
Base.call(plain, 9);
console.log(tell(plain), "|", tell(Object.assign(Object.create(Base.prototype), { early: 1 }, (o => (Base.call(o, 10), o))({}))));
function Odd() {}
Odd.prototype = null;
console.log(tell(Reflect.construct(Base, [11], Odd)));
const kept = Base.prototype;
Base.prototype = { replaced: true };
const behind = new Base(12);
console.log(behind.how, behind.a, behind.replaced, Object.keys(behind).join("+"));
Base.prototype = 5;
const belowObject = new Base(13);
console.log(belowObject.how, Object.getPrototypeOf(belowObject) === Object.prototype, Object.keys(belowObject).join("+"));
Base.prototype = kept;
console.log(tell(new Base(14)));

class Top {
  constructor(a) {
    if (new.target === Top) { this.how = "own"; this.a = a; this.b = 1; this.c = "c"; } else { this.how = "below"; this.a = a; }
  }
}
class Under extends Top { extra = 1; }
globalThis.madeUpTop = Top;
globalThis.madeUpUnder = Under;
console.log(Object.entries(new Top(1)).join(" "), "|", Object.entries(new Under(2)).join(" "), "|", Object.entries(Reflect.construct(Top, [3], Under)).join(" "));

function maker(tag) {
  return function Inner(a) {
    if (new.target === Inner) { this.how = "own " + tag; this.a = a; this.b = 1; } else { this.how = "other " + tag; this.a = a; }
  };
}
const First = maker("first"), Second = maker("second");
globalThis.madeUpFirst = First;
console.log(Object.values(new First(1)).join(" "), "|", Object.values(new Second(2)).join(" "), "|", Object.values(Reflect.construct(First, [3], Second)).join(" "), "|", Object.getPrototypeOf(Reflect.construct(First, [4], Second)) === Second.prototype);
