// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the objects and of what stands above them is asked again at run time
// `function F() {}` reads no `this`: what `new F()` makes is an object of F all the same: it takes names later, finds what lies above, is handed out, is made for another new.target, or is replaced by what F returns.
function Plain() {}
const plain = new Plain();
plain.late = 1;
console.log(plain.late, plain instanceof Plain, Object.keys(plain).join(), plain.constructor === Plain);

function Base() { this.a = 1; }
Base.prototype.read = function () { return this.a; };
function Below() {}
Object.setPrototypeOf(Below.prototype, Base.prototype);
Object.setPrototypeOf(Below, Base);
const below = new Below(), made = new Base();
console.log(made.read(), below.read(), below instanceof Base);
below.a = 7;
console.log(below.read(), made.read());

function WithMethods() {}
WithMethods.prototype.count = 0;
WithMethods.prototype.bump = function () { return ++this.count; };
const first = new WithMethods(), second = new WithMethods();
console.log(first.bump(), first.bump(), second.bump(), WithMethods.prototype.count, Object.keys(first).join());

function Returns() { return { other: true }; }
function ReturnsNumber() { return 5; }
console.log(new Returns().other, new Returns() instanceof Returns, new ReturnsNumber() instanceof ReturnsNumber);

function HandedOut() {}
const kept = new HandedOut();
globalThis.madeUpKept = kept;
globalThis.madeUpKept.fromOutside = "laid";
console.log(kept.fromOutside);

console.log(Reflect.construct(Plain, [], Base) instanceof Base, Reflect.construct(Base, [], Plain) instanceof Plain, Reflect.construct(Base, [], Plain).a);
class Heir extends Plain { constructor() { super(); this.own = 1; } }
console.log(new Heir().own, new Heir() instanceof Plain);
const Bound = Plain.bind(null);
console.log(new Bound() instanceof Plain, typeof Plain(), typeof Plain.call({ x: 1 }));
Plain.prototype = { replaced: true };
console.log(new Plain().replaced, plain.replaced);
