// Alone: the second evaluation of a class is known by no table: beside other programs its guards may be left.
// What the run time keeps on the prototype object of a later evaluation is seen by nothing that a program can ask.
const make = t => class { constructor() { this.a = t; } m() { return t; } };
for (let i = 0; i < 3; i++) {
  const C = make(i);
  const p = C.prototype;
  console.log(i, Reflect.ownKeys(p).map(String).join(), Object.getOwnPropertySymbols(p).length, Object.getOwnPropertyNames(p).join(), JSON.stringify(Object.getOwnPropertyDescriptors(p)));
  console.log(Object.isFrozen(Object.freeze(p)), Object.isSealed(p), Object.isExtensible(p), JSON.stringify(p), Object.keys({ ...p }).length, Object.keys(Object.assign({}, p)).length);
  console.log(p, new C().m(), new C() instanceof C);
  const copy = Object.create(Object.getPrototypeOf(p), Object.getOwnPropertyDescriptors(p));
  class D extends C { constructor() { super(); this.b = 1; } }
  Object.setPrototypeOf(D.prototype, copy);
  console.log(JSON.stringify(new D()), new D().m());
}
