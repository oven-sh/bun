// readers that are no plain inner function: a field's initializer, a static field, a getter, a default value. plain: true true true true
const n = +process.argv[2] || 3;
const above = made => Object.getPrototypeOf(made);
function f() {
  "use strict";
  function* gen() { yield n; }
  class Holder {
    made = gen();
    static first = gen();
  }
  const box = { get made() { return gen(); } };
  const byDefault = (made = gen()) => made;
  const a = () => gen();
  return [above(new Holder().made), above(Holder.first), above(box.made), above(byDefault())].map(it => it === above(a())).join(" ");
}
console.log(f());
