// The field of the base hides the getter that an heir declares.
class Base { [Symbol.toStringTag] = JSON.parse('"own"'); }
class Loud extends Base { get [Symbol.toStringTag]() { return "getter"; } }
class A extends Base {}
class B extends Base {}
class C extends Base {}
class D extends Base {}
function tagOf(loud) { return loud[Symbol.toStringTag]; }
const louds = [];
for (let i = 0; i < 3; i++) louds.push(new Loud());
const others = [new A(), new B(), new C(), new D()];
console.log(tagOf(new Loud()), others.length, louds.length);
