// A recursive function tests two values with instanceof. Between the tests the prototype of the subclass gets another parent.
class Pair { constructor(car, cdr) { this.car = car; this.cdr = cdr; } }
class Sub extends Pair { constructor(car, cdr) { super(car, cdr); this.size = 2; } }
let depth = 0, at = -1, parent = Object.prototype;
function change() { if (depth === at) Object.setPrototypeOf(Sub.prototype, parent); return depth; }
const same = function (t, u) {
  depth++;
  if (!(u instanceof Pair)) return u === t ? 1 : 2;
  change();
  if (!(t instanceof Pair)) return 1000;
  return same(t.car, u.car) + same(t.cdr, u.cdr);
};
const count = function (t, u) {
  depth++;
  if (!(u instanceof Sub)) return 0;
  Object.defineProperty(Sub, "name", { value: "Sub" + depth });
  if (depth === at) Object.defineProperty(Sub, Symbol.hasInstance, { value: v => v === parent, configurable: true });
  if (!(t instanceof Sub)) return 100;
  return 1 + count(t.cdr, u.cdr);
};
function list(n) { let l = null; for (let i = 0; i < n; i++) l = i % 3 ? new Pair(i, l) : new Sub(i, l); return l; }
function subs(n) { let l = null; for (let i = 0; i < n; i++) l = new Sub(i, l); return l; }
for (let i = 0; i < 5; i++) console.log(same(list(6), list(6)), same(subs(5), subs(5)), count(subs(4), subs(5)), count(list(4), subs(5)));
depth = 0; at = 3;
console.log(count(subs(6), subs(6)), count(subs(2), subs(2)), new Sub(1, 2) instanceof Sub);
delete Sub[Symbol.hasInstance];
depth = 0; at = 5;
console.log(same(subs(6), list(6)), new Sub(1, 2) instanceof Pair);
Object.setPrototypeOf(Sub.prototype, Pair.prototype);
depth = 0; at = 4; parent = null;
console.log(same(subs(6), subs(6)), new Sub(1, 2) instanceof Pair, new Sub(1, 2) instanceof Object);
Object.setPrototypeOf(Sub.prototype, Pair.prototype);
depth = 0; at = -1;
console.log(same(list(6), subs(6)), new Sub(1, 2) instanceof Pair);
