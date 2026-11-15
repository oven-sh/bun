// Two constructor functions stand below a class as older code writes it: each hands its own new.target to Reflect.construct of the class. The class's constructor makes its own cell below their prototypes, in turn with its own.
// COUNT: operation:operationAOTSetConstructPrototype <= 4000
"use strict";
class Base { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + 1 + work; } twice() { return this.size * 2; } }
function below(make) {
  make.prototype = Object.create(Base.prototype, { constructor: { value: make, writable: true, configurable: true } });
  Object.setPrototypeOf(make, Base);
  return make;
}
const Old = below(function Old(n) { const made = Reflect.construct(Base, [n], new.target); made.old = n; return made; });
const Older = below(function Older(n) { const made = Reflect.construct(Base, [n + 1], new.target); made.older = n; made.more = "m"; return made; });
let sum = 0, wrong = 0;
for (let turn = 0; turn < 60000; turn++) {
  const one = new Old(turn), two = new Older(turn), three = new Base(turn);
  if (!(one instanceof Old) || !(two instanceof Older) || !(one instanceof Base) || three instanceof Old || Object.getPrototypeOf(three) !== Base.prototype) wrong++;
  sum += one.twice() + one.old + two.twice() + two.older + two.more.length + three.twice();
}
console.log(sum, wrong, Object.keys(new Old(1)).join(""), Object.keys(new Older(1)).join(""));
