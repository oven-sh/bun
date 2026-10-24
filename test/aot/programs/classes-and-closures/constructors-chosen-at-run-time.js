// `new C(..)` and `super(..)` where the constructor is one of a few functions, chosen at run time.
function Plain(x) { this.x = x; }
Plain.prototype.describe = function () { return "Plain " + this.x; };
function Other(x) { this.y = x; }
Other.prototype.describe = function () { return "Other " + this.y; };
function ReturnsObject(x) { this.x = x; return { describe() { return "replaced " + x; } }; }
function ReturnsNumber(x) { this.x = x; return 7; }
ReturnsNumber.prototype.describe = function () { return "ReturnsNumber " + this.x; };
function SeesNewTarget(x) { this.name = new.target === undefined ? "none" : new.target.name; }
SeesNewTarget.prototype.describe = function () { return "SeesNewTarget " + this.name; };
class Base { constructor(x) { this.x = x; this.target = new.target.name; } describe() { return "Base " + this.x + " " + this.target; } }
class Sibling { constructor(x) { this.z = x; } describe() { return "Sibling " + this.z; } }
class Derived extends Base { constructor(x) { super(x + 1); this.d = x; } describe() { return "Derived " + this.d + " " + super.describe(); } }
class Implicit extends Sibling {}
const arrow = x => x;
const method = { m(x) { this.x = x; } }.m;
async function asynchronous(x) { this.x = x; }

function make(C, x) { return new C(x); }
function tryMake(C, x) {
    try { return make2(C, x).describe(); } catch (error) { return error instanceof TypeError ? "TypeError" : error.constructor.name + ": " + error.message; }
}
function make2(C, x) { return new C(x); }
function makeWithTarget(C, T, x) { return Reflect.construct(C, [x], T); }

const constructors = [Plain, Other, ReturnsObject, ReturnsNumber, SeesNewTarget, Base, Sibling, Derived, Implicit];
for (let round = 0; round < 3; round++) {
    for (let i = 0; i < constructors.length; i++) {
        const object = make(constructors[i], round * 10 + i);
        console.log(object.describe(), object instanceof constructors[i], Object.getPrototypeOf(object) === constructors[i].prototype, Object.keys(object).join());
    }
}
for (const C of [Plain, Base, arrow, method, asynchronous, undefined, null, 7, "text", {}, Map, Error, Date.now, Symbol, Proxy])
    console.log(tryMake(C, 1));

function twoFunctions(flag, x) { return new (flag ? Plain : Other)(x); }
function twoClasses(flag, x) { return new (flag ? Base : Sibling)(x); }
function functionOrClass(flag, x) { return new (flag ? Plain : Derived)(x); }
function classOrNothing(flag, x) { const C = flag ? Base : undefined; return new C(x); }
for (let i = 0; i < 6; i++)
    console.log(twoFunctions(i & 1, i).describe(), twoClasses(i & 1, i).describe(), functionOrClass(i & 1, i).describe());
try { classOrNothing(true, 1); classOrNothing(false, 2); } catch (error) { console.log(error.constructor.name); }

const mixin = Parent => class Mixed extends Parent {
    constructor(...values) { super(...values); this.mixed = values.length; }
    describe() { return "Mixed " + this.mixed + " " + super.describe(); }
};
const mixed = [mixin(Base), mixin(Sibling), mixin(Plain), mixin(Derived), mixin(ReturnsObject), mixin(SeesNewTarget)];
for (let round = 0; round < 2; round++) {
    for (const C of mixed) {
        const object = new C(round, "ignored");
        console.log(object.describe(), object instanceof C, object.mixed);
    }
}
const fixed = Parent => class Fixed extends Parent { constructor(x) { super(x, x); this.fixed = true; } };
for (const C of [fixed(Base), fixed(Sibling), fixed(Other)])
    console.log(new C(3).describe(), new C(4).fixed);
try { new (fixed(null))(1); } catch (error) { console.log(error.constructor.name); }

console.log(makeWithTarget(Plain, Other, 1) instanceof Other, makeWithTarget(Base, Sibling, 2).target, makeWithTarget(SeesNewTarget, Plain, 3).name);

Plain.prototype = { describe() { return "new prototype " + this.x; } };
Other.prototype = 5;
console.log(twoFunctions(1, 8).describe(), Object.getPrototypeOf(twoFunctions(0, 9)) === Object.prototype, make(Plain, 10).describe());
