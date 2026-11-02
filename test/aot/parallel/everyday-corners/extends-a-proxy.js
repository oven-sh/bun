// Extends a proxy: compiled answers as plain.
class A {
  m() {
    return "A";
  }
}
const seen = [];
const PA = new Proxy(A, {
  construct(t, a, nt) {
    seen.push("construct");
    return Reflect.construct(t, a, nt);
  },
  get(t, k, r) {
    if (typeof k === "string") seen.push(k);
    return Reflect.get(t, k, r);
  },
});
class B extends PA {}
console.log(new B().m(), seen.join());
