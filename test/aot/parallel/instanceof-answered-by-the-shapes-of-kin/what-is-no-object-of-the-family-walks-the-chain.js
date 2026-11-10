// Beside the kin: primitives, a plain record, a list, a function, an object made by Object.create below the class, a proxy over a cat, an object of a class made twice.
// STATISTIC: MissesOfInstanceOfAnsweredByShapesOfKin >= 1
class Animal { constructor(n) { this.n = n; } }
class Cat extends Animal {}
class Dog extends Animal {}
function makeClass() { return class Stray extends Cat {}; }
const First = makeClass(), Second = makeClass();
let traps = 0;
const things = JSON.parse('[1, "cat", null, true, {"n": 3}, [4]]');
things.push(undefined, () => 1, new Cat(1), new Dog(2), Object.create(Cat.prototype), Object.create(Dog.prototype), Object.create(null),
  new Proxy(new Cat(5), { getPrototypeOf(target) { traps++; return Reflect.getPrototypeOf(target); } }), new First(6), new Second(7), Cat.prototype, Cat);
function cats() {
  let bits = "";
  for (let i = 0; i < things.length; i++) bits += things[i] instanceof Cat ? "1" : "0";
  return bits;
}
let last = "";
for (let turn = 0; turn < 30; turn++) last = cats();
console.log(last, traps);
