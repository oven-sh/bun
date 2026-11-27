// A copy of a factory stands where the call is. What the factory names is what it names where it is written.
var Base = Object, config = { level: 1 }, holder = "the file";
function extend(P) { return class extends P { base() { return Base.name; } level() { return config.level; } }; }
const mix = P => class extends P { base() { return Base.name; } set(to) { return (config = { level: to }).level; } };
const say = (...all) => console.log(...all);
{
  const A = ((Base) => extend(Base))(Array), B = extend(Map);
  say(new A().base(), new B().base(), Object.getPrototypeOf(A).name, Object.getPrototypeOf(B).name);
}
{
  const A = ((config) => ((Base) => extend(Base))(Set))({ level: 9 }), B = ((other) => extend(other))(Map);
  say(new A().base(), new A().level(), new B().base(), new B().level());
}
{
  const A = ((config) => class extends mix(Array) {})({ level: 5 }), B = mix(Map);
  say(new A().set(3), config.level, new B().set(4), config.level, new A().base());
}
function named(P) { return class extends P { what() { return typeof Shape; } }; }
var Shape = "a word";
{
  const Round = class Shape extends named(Object) {}, Flat = named(Map), Both = class extends (class Shape extends named(Set) {}) {};
  say(new Round().what(), new Flat().what(), new Both().what(), Round.name);
}
function storing(P) { return class extends P { what() { return typeof Store.load; } }; }
class Store extends storing(Object) { static load() {} }
const Other = storing(Array);
Store = { load: 1 };
say(new Other().what(), Object.getPrototypeOf(Object.getPrototypeOf(Other)) === Array);
{
  const A = (function holder() { return kept(Object); })(), B = kept(Array), C = (() => { { function holder() {} } return kept(Map); })();
  say(new A().what(), new B().what(), new C().what());
}
function kept(P) { return class extends P { what() { return typeof holder; } }; }
{
  const A = (() => { try { throw Array; } catch (Base) { return extend(Base); } })(), B = (function () { var Base = Set; return extend(Base); })(), C = (() => { eval("var Base = Map"); return extend(Set); })();
  say(new A().base(), new B().base(), new C().base());
}
let made;
(function () { eval("var hidden = 'of the eval'"); made = P => class extends P { hidden() { return typeof hidden; } }; })();
const One = made(Object), Two = made(Array);
say(new One().hidden(), new Two().hidden());
function closures(step) { return function (n) { return config.level + n * step; }; }
const twice = ((config) => closures(2))({ level: 100 }), thrice = closures(3);
let sum = 0;
for (let i = 0; i < 5; i++) sum += twice(i) * 10 + thrice(i);
say(sum);
const Class = { create: function () { return function () { this.level = config.level; this.kind = typeof Shape; }; } };
const Point = ((config) => Class.create())({ level: 50 }), Line = Class.create();
say(new Point().level, new Line().level, new Point() instanceof Line, new Line().kind);
const globals = P => class extends P { global() { return typeof Reflect; } };
const G = ((Reflect) => globals(Reflect))(Array), H = globals(Map);
say(new G().global(), new H().global());
let fromParameter;
(function (value, keep = (fromParameter = P => class extends P { value() { return value; } })) {
  var value = "of the body";
  const A = fromParameter(Object), B = fromParameter(Array);
  say(new A().value(), new B().value(), value);
})("of the parameter");
