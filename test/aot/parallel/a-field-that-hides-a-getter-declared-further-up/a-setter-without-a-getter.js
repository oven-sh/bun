// The field hides a setter that has no getter beside it: the read finds the field and not undefined.
class Base { [Symbol.toStringTag] = JSON.parse('"own"'); }
class Mute extends Base { set [Symbol.toStringTag](v) {} }
class A extends Base {} class B extends Base {} class C extends Base {}
const tagOf = m => m[Symbol.toStringTag];
const others = [new A(), new B(), new C()];
console.log(tagOf(new Mute()), others.length);
