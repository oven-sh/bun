// A function that returns `class extends K` is called twice: the instances of both classes get the private field and the brand of K from the base constructor.
class K { #p = 0; getP() { return this.#p; } bump() { this.#p += 1; return this; } static has(o) { return #p in o; } }
function make(n) { return class extends K { tag = n; get() { return 1; } }; }
const A = make(1), B = make(2);
const a = new A, b = new B, a2 = new A;
console.log(a.get(), a.getP(), a.tag, K.has(a), b.bump().bump().getP(), b.tag, K.has(b), a2.tag, a2.getP());
console.log(K.has({}), K.has(new K), a instanceof A, a instanceof B, b instanceof K, Object.keys(a).join(), JSON.stringify(b));
console.log(K.has(Reflect.construct(K, [], A)), Reflect.construct(K, [], A).tag, Reflect.construct(K, [], A) instanceof A, Reflect.construct(A, [], K).tag, K.has(Reflect.construct(A, [], K)));
