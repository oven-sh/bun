function Animal(n) { this.n = n; }
Animal.create = function (n) { return n + 3; };
function Dog(n) { Animal.call(this, n); }
Object.setPrototypeOf(Dog, Animal);
Dog.prototype = Object.create(Animal.prototype);
function Other() { }
Other.create = function (n) { return n + 2000; };
Other.call = function (self, n) { self.n = n + 50; };
globalThis.Dog = Dog;
globalThis.Other = Other;
const held = { n: 0 };
function run(count) {
  let before = 0, after = 0;
  for (let i = 0; i < count; i++) {
    if (i === 5) (0, eval)("Object.setPrototypeOf(Dog, Other)");
    Dog.call(held, i);
    if (i < 5) before += Dog.create(i) + held.n; else after += Dog.create(i) + held.n;
  }
  return before + " " + after;
}
console.log(run(10));
