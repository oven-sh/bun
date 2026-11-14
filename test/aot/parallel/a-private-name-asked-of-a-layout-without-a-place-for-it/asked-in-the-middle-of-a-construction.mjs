const out = [];
class A { constructor() { out.push("base " + B.is(this)); } }
class B extends A { before = out.push("field-before " + B.is(this)); #x = 1; after = out.push("field-after " + B.is(this)); static is(o) { return #x in o; } constructor() { super(); out.push("done " + B.is(this)); } }
new B(); new B();
console.log(out.join(" | "));
