// Private methods and accessors of a base class work on the instances of classes that a function creates below it.
class Base {
    #v = 3;
    #m() { return this.#v + 1; }
    get #a() { return this.#v * 2; }
    set #a(n) { this.#v = n; }
    run() { let before = this.#m(); this.#a = 10; return before + "," + this.#m() + "," + this.#a; }
    static has(o) { return #m in o; }
    static hasAccessor(o) { return #a in o; }
}
function make() { return class extends Base { y = 2; }; }
const A = make(), B = make();
const a = new A, b = new B;
console.log(a.run(), a.y, Base.has(a), Base.hasAccessor(a), b.run(), Base.has(b), Base.has({}), Object.keys(a).join());
console.log(new Base().run(), Base.has(Reflect.construct(Base, [], A)), Reflect.construct(Base, [], B).run());
