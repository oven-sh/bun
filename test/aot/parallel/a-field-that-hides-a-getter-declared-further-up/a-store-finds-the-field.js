// A store under the key writes the field that hides the accessor: the setter does not run.
let calls = 0;
class Base { [Symbol.toStringTag] = JSON.parse('"own"'); }
class Loud extends Base {
  get [Symbol.toStringTag]() { return "getter"; }
  set [Symbol.toStringTag](v) { calls++; }
}
class A extends Base {} class B extends Base {} class C extends Base {}
function rename(l) { l[Symbol.toStringTag] = "new"; return l[Symbol.toStringTag]; }
const others = [new A(), new B(), new C()];
console.log(rename(new Loud()), calls, others.length);
