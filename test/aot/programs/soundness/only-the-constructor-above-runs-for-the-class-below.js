// Only the constructor of the class above runs, for the class below.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); }
const seen = [];
class Base { constructor() { this.ba = { qc: 1 }; } }
class Derived extends Base { da = { qc: 2 }; read() { return this.da.qc; } }
const odd = Reflect.construct(Base, [], Derived);
console.log(odd instanceof Derived, attempt(() => odd.read()), attempt(() => odd.da.qc), Object.keys(odd).join());
const fine = new Derived();
console.log(fine.read());
const odd2 = Reflect.construct(Object, [], Derived);
console.log(odd2 instanceof Derived, attempt(() => odd2.read()), attempt(() => odd2.ba.qc));
const odd3 = Reflect.construct(function () { this.zz = 1; }, [], Derived);
console.log(odd3 instanceof Derived, attempt(() => odd3.read()), Object.keys(odd3).join());
const odd4 = Object.create(Derived.prototype);
console.log(attempt(() => odd4.read()));
const odd5 = { __proto__: Derived.prototype };
console.log(attempt(() => odd5.read()));
class Other { oa = { qc: 9 }; }
const odd6 = Reflect.construct(Other, [], Derived);
console.log(odd6 instanceof Derived, attempt(() => odd6.read()), attempt(() => odd6.oa.qc));
const odd7 = Reflect.construct(Derived, [], Other);
console.log(odd7 instanceof Other, attempt(() => odd7.da.qc), attempt(() => odd7.oa.qc), attempt(() => Derived.prototype.read.call(odd7)));
