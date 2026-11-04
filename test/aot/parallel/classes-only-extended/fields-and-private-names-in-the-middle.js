class Base { a = 1; #p = 10; p() { return this.#p; } static is(o) { return #p in o; } }
class Middle extends Base { b = 2; #q = 20; q() { return this.#q; } static is(o) { return #q in o; } }
class Kind extends Middle { c = 3; #r = 30; r() { return this.#r; } }
const kind = new Kind();
console.log(Object.keys(kind).join(), kind.p(), kind.q(), kind.r(), Base.is(kind), Middle.is(kind));
const middle = Reflect.construct(Object.getPrototypeOf(Kind), []);
console.log(Object.keys(middle).join(), middle.p(), middle.q(), Base.is(middle), Middle.is(middle), middle instanceof Kind, typeof middle.r);
