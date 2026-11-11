// The field holds a text and the two getters below answer integers: what is added to is the text.
class Base { [Symbol.toStringTag] = JSON.parse('"own"'); }
class Loud extends Base { n = JSON.parse("3"); get [Symbol.toStringTag]() { return this.n | 0; } }
class Soft extends Base { n = JSON.parse("4"); get [Symbol.toStringTag]() { return this.n | 0; } }
class A extends Base {} class B extends Base {} class C extends Base {}
function next(x) { const t = x[Symbol.toStringTag]; return t + 1; }
const others = [new A(), new B(), new C()];
console.log(next(new Loud()), next(new Soft()), others.length);
