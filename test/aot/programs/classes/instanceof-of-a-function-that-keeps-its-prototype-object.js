// `this instanceof F` and `x instanceof F` where F is a function that is constructed with and nothing replaces F.prototype.
var out = [];
function say() { out.push(Array.prototype.map.call(arguments, String).join(" ")); }

// Callable with and without `new`.
function V(x) {
  if (!(this instanceof V)) return new V(x);
  this.x = x;
}
V.prototype.get = function () { return this.x + 1; };
function both(n) { var s = 0; for (var i = 0; i < n; i++) s += V(i & 7).get() + new V(i & 3).get(); return s; }
say(both(50), V(1) instanceof V, new V(1) instanceof V, V.call(undefined, 2).x, V.call(null, 3).x, V.call(5, 4).x, V.call({}, 5).x);

// `this` is an object of the function already: the call stores into it and returns nothing.
var given = new V(1);
say(V.call(given, 9), given.x);

// `this` inherits from the prototype object without having been constructed.
var created = Object.create(V.prototype);
say(V.call(created, 6), created.x, created instanceof V, created.get());

// An object of the function that gets another prototype.
function isV(o) { return o instanceof V; }
var moved = new V(2);
say(isV(moved), isV({}), isV(null), isV(undefined), isV(3), isV("text"), isV(V), isV(V.prototype));
Object.setPrototypeOf(moved, null);
say(isV(moved), isV(new V(3)));
var movedBack = new V(4);
Object.setPrototypeOf(movedBack, { __proto__: V.prototype });
say(isV(movedBack));
var viaProto = new V(5);
viaProto.__proto__ = Array.prototype;
say(isV(viaProto), viaProto instanceof Array);
say(V.call(moved, 8) instanceof V, moved.x);

// Another new.target.
function Other() {}
Other.prototype.who = "other";
var reflected = Reflect.construct(V, [7], Other);
say(isV(reflected), reflected instanceof Other, reflected.x, JSON.stringify(reflected), reflected.who);
class Below extends V { constructor(x) { super(x); this.below = true; } }
var below = new Below(8);
say(isV(below), below instanceof Below, below.x, below.get(), below.below);

// One text, several functions.
function make() {
  function Made(x) { if (!(this instanceof Made)) return new Made(x); this.x = x; }
  Made.is = function (o) { return o instanceof Made; };
  return Made;
}
var First = make(), Second = make();
say(First.is(First(1)), First.is(Second(1)), Second.is(First(1)), Second.is(new Second(1)), First(1) instanceof Second, First(2).x);

// The function answers for itself.
function Judged() {}
Object.defineProperty(Judged, Symbol.hasInstance, { value: function (o) { return o === 1; } });
say(new Judged() instanceof Judged, 1 instanceof Judged);

// A bound function.
var BoundV = V.bind(null);
say(new V(1) instanceof BoundV, new BoundV(2) instanceof V, BoundV(3) instanceof V);

// Above: a link that changes.
function Base() {}
function Mid() {}
Object.setPrototypeOf(Mid.prototype, Base.prototype);
function isBase(o) { return o instanceof Base; }
var mid = new Mid();
say(isBase(mid), isBase(new Base()), mid instanceof Mid);
Object.setPrototypeOf(Mid.prototype, Object.prototype);
say(isBase(mid), isBase(new Mid()), mid instanceof Mid);

// The property is replaced by a definition, and by a store that comes late.
function Redefined() {}
var early = new Redefined();
function isRedefined(o) { return o instanceof Redefined; }
say(isRedefined(early));
Object.defineProperty(Redefined, "prototype", { value: { late: true } });
say(isRedefined(early), isRedefined(new Redefined()), new Redefined().late);
function Stored() {}
var earlyStored = new Stored();
function isStored(o) { return o instanceof Stored; }
say(isStored(earlyStored));
Stored.prototype = { late: 1 };
say(isStored(earlyStored), isStored(new Stored()));
function ByKey() {}
var earlyByKey = new ByKey();
function isByKey(o) { return o instanceof ByKey; }
var key = ["proto", "type"].join("");
say(isByKey(earlyByKey));
ByKey[key] = { late: 2 };
say(isByKey(earlyByKey), isByKey(new ByKey()));
function NotAnObject() {}
NotAnObject.prototype = 5;
try { say({} instanceof NotAnObject); } catch (error) { say(error instanceof TypeError); }
say(Object.getPrototypeOf(new NotAnObject()) === Object.prototype);

// The check that compilers write in front of a class's body.
function check(instance, Constructor) { if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function"); }
function Checked(x) { check(this, Checked); this.x = x; }
say(new Checked(1).x);
try { Checked(2); } catch (error) { say(error.message); }
try { Checked.call({}, 2); } catch (error) { say(error.message); }
say(Checked.call(new Checked(3), 4));

// The object gets another prototype between its birth and the test.
function Shifty(to) { Object.setPrototypeOf(this, to); this.was = this instanceof Shifty; }
say(new Shifty(null).was, new Shifty(Shifty.prototype).was, new Shifty({ __proto__: Shifty.prototype }).was, new Shifty(Array.prototype).was);
function ShiftyByName(to) { this.__proto__ = to; this.was = this instanceof ShiftyByName; }
say(new ShiftyByName(Object.prototype).was, new ShiftyByName(ShiftyByName.prototype).was);
function Handed(shift) { shift(this); check(this, Handed); this.ok = true; }
say(new Handed(function () {}).ok);
try { new Handed(function (o) { Object.setPrototypeOf(o, Object.prototype); }); } catch (error) { say(error.message); }

// A function is given the prototype object of another one, which keeps it: what either makes is an instance of both, whichever is constructed first.
function Lender(x) { this.x = x; }
function Taker(y) { this.y = y; }
Taker.prototype = Lender.prototype;
function isLender(o) { return o instanceof Lender; }
function isTaker(o) { return o instanceof Taker; }
var takenFirst = new Taker(1), lentSecond = new Lender(2);
say(isLender(takenFirst), isTaker(takenFirst), isLender(lentSecond), isTaker(lentSecond), isTaker({}), isLender({}));
function LenderFirst(x) { this.x = x; }
function TakerSecond(y) { this.y = y; }
var holders = { one: TakerSecond };
holders.one[["proto", "type"].join("")] = LenderFirst.prototype;
var lentFirst = new LenderFirst(1), takenSecond = new TakerSecond(2);
say(lentFirst instanceof TakerSecond, takenSecond instanceof LenderFirst, lentFirst instanceof LenderFirst, takenSecond instanceof TakerSecond);
function LenderNeverMade() {}
function TakerAlone() {}
TakerAlone.prototype = LenderNeverMade.prototype;
say(new TakerAlone() instanceof LenderNeverMade, new TakerAlone() instanceof TakerAlone, Object.create(LenderNeverMade.prototype) instanceof TakerAlone);

console.log(out.join("\n"));
