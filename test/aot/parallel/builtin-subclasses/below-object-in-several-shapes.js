// Flags: --aot-check=verify-each-stage
// Env of the executable: BUN_JSC_validateAOTRuntime=1
// Classes written below Object, in several shapes.
class A extends Object { constructor() { super(); this.self = () => this; this.n = 1; } get twice() { return this.n * 2; } grow() { this.n++; return this; } static make() { return new this(); } }
class B extends A { constructor() { super(); this.extra = "b"; } grow() { super.grow(); this.n += 10; return this; } }
class C extends Object {}
class D extends Object { #hidden = 5; read() { return this.#hidden; } static is(x) { return #hidden in x; } }
class E extends Object { constructor(given) { super(given); this.given = given; } }
const a = new A(), b = new B(), c = new C(), d = new D(), e = new E({ x: 1 });
console.log(a.self() === a, b.self() === b, typeof a.self, Object.keys(a).join(), Object.keys(b).join(), a.twice, b.grow().twice, A.make() instanceof A, B.make() instanceof B, B.make().extra);
console.log(c instanceof C, c instanceof Object, Object.getPrototypeOf(c) === C.prototype, JSON.stringify(c), d.read(), D.is(d), D.is(a), e instanceof E, JSON.stringify(e), e.given.x);
function sum(list) { let total = 0; for (const each of list) total += each.n; return total; }
const many = []; for (let i = 0; i < 1000; i++) many.push(i & 1 ? new A() : new B().grow());
console.log(sum(many), many[0].self() === many[0], Reflect.construct(A, [], C) instanceof C, Object.prototype.toString.call(a), String(a), a.hasOwnProperty("n"), a.constructor === A);
