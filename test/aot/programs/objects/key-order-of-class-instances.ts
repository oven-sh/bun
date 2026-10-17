// The key order of class instances whose fields have no initializers and are assigned in the constructor in another order.
class A { a: number; b: number; c = 3; constructor() { this.b = 2; this.a = 1 } }
class B { declare p: number; q: number | undefined; r?: string; constructor(set: boolean) { if (set) { this.r = "r"; this.p = 1 } } }
class D extends A { d = 4; e: number; constructor() { super(); this.e = 5 } }
console.log(JSON.stringify(new A()), Object.keys(new B(false)).join(), Object.keys(new B(true)).join(), JSON.stringify(new D()))
const late = new B(false)
late.r = "x"; late.q = 1
console.log(Object.keys(late).join())
