// new.target decides the prototype of what is made, whoever's body runs.
function attempt(run) { try { return run(); } catch (error) { return error.constructor.name; } }
class Base { kind = "base"; constructor() { this.target = new.target && new.target.name; } who() { return "Base.who"; } }
class Derived extends Base { extra = "extra"; who() { return "Derived.who"; } }
function Plain() { this.target = new.target && new.target.name; this.own = 1; }
Plain.prototype.who = function () { return "Plain.who"; };
function Other() {}
Other.prototype.who = function () { return "Other.who"; };
const describe = made => [made.target, made.who && made.who(), Object.keys(made).join(), made instanceof Base, made instanceof Derived, made instanceof Plain, made instanceof Other].join(" ");
console.log(describe(Reflect.construct(Base, [], Derived)));
console.log(describe(Reflect.construct(Derived, [], Base)));
console.log(describe(Reflect.construct(Base, [], Plain)));
console.log(describe(Reflect.construct(Plain, [], Base)));
console.log(describe(Reflect.construct(Plain, [], Other)));
console.log(describe(Reflect.construct(Derived, [], Other)));
// The prototype property of new.target is no object: the realm's default of the function whose body makes the object.
function Odd() {}
Odd.prototype = 5;
console.log(Object.getPrototypeOf(Reflect.construct(Base, [], Odd)) === Object.prototype, Object.getPrototypeOf(Reflect.construct(Plain, [], Odd)) === Object.prototype, Object.getPrototypeOf(Reflect.construct(Array, [], Odd)) === Array.prototype, Object.getPrototypeOf(Reflect.construct(Map, [], Odd)) === Map.prototype, Object.getPrototypeOf(Reflect.construct(Error, ["m"], Odd)) === Error.prototype);
// It is read once, through a getter, a bound function, a proxy.
let reads = 0;
const bound = Other.bind(null);
console.log(attempt(() => describe(Reflect.construct(Base, [], bound))), attempt(() => Object.getPrototypeOf(Reflect.construct(Plain, [], bound)) === Object.prototype));
const counting = new Proxy(Other, { get(target, key, receiver) { if (key === "prototype") reads++; return Reflect.get(target, key, receiver); } });
console.log(describe(Reflect.construct(Base, [], counting)).replace("undefined", "-"), reads, describe(Reflect.construct(Derived, [], counting)).replace("undefined", "-"), reads, describe(Reflect.construct(Plain, [], counting)).replace("undefined", "-"), reads);
// What is no constructor is refused before anything runs.
let ran = 0;
function Counts() { ran++; }
console.log(attempt(() => Reflect.construct(Counts, [], () => {})), attempt(() => Reflect.construct(Counts, [], { prototype: {} })), attempt(() => Reflect.construct(Counts, [], Math.max)), attempt(() => Reflect.construct(() => {}, [])), attempt(() => Reflect.construct(Counts, [], async function () {})), attempt(() => Reflect.construct(Counts, [], class {}) instanceof Counts), ran);
// The prototype is changed between two constructions, and inside one.
function Shifts() { this.seen = Object.getPrototypeOf(this).label; }
Shifts.prototype.label = "first";
const a = new Shifts();
Shifts.prototype = { label: "second" };
const b = new Shifts();
console.log(a.seen, b.seen, a instanceof Shifts, b instanceof Shifts);
class Root { constructor() { Late.prototype.label = "changed in Root"; } }
class Late extends Root { label2 = Object.getPrototypeOf(this).label; }
console.log(new Late().label2);
class Swaps extends Base { constructor() { Object.setPrototypeOf(Swaps, Plain); super(); } }
console.log(describe(new Swaps()));
// new.target in functions that are called, in arrows, in eval-free nested code.
function called() { return new.target === undefined; }
function viaArrow() { return (() => new.target)(); }
console.log(called(), new viaArrow() instanceof viaArrow === false, viaArrow() === undefined, Reflect.construct(viaArrow, [], Other) === Other);
