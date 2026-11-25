class A { a() { return 1; } static s() { return "A"; } }
class B extends A { b() { return this.a() + 1; } }
class C extends B { c() { return this.b() + 1; } static t() { return super.s() + "C"; } }
console.log(new C().c(), C.t(), C.s(), Object.getPrototypeOf(C) === B, Object.getPrototypeOf(B) === A, Object.getPrototypeOf(C.prototype) === B.prototype, Object.getPrototypeOf(B.prototype) === A.prototype, Object.getPrototypeOf(A.prototype) === Object.prototype, Object.getPrototypeOf(A) === Function.prototype);
console.log(Object.getOwnPropertyNames(C).join(), Object.getOwnPropertyNames(C.prototype).join(), Object.getOwnPropertyNames(B).join(), Object.getOwnPropertyNames(B.prototype).join(), C.name, B.name, C.length, String(B).slice(0, 17));
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(B, "prototype")), B.prototype.constructor === B, C.prototype.constructor === C);
