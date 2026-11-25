function Animal(n) { this.n = n; }
function Dog(n) { Animal.call(this, n); }
Object.setPrototypeOf(Dog, Animal);
Dog.prototype = Object.create(Animal.prototype);
globalThis.Animal = Animal;
const held = { n: 0 };
function run(count) {
  let before = 0, after = 0;
  for (let i = 0; i < count; i++) {
    if (i === 5) (0, eval)("Animal.call = function (self, n) { self.n = n + 10; }");
    Dog.call(held, i);
    if (i < 5) before += new Dog(i).n + held.n; else after += new Dog(i).n + held.n;
  }
  return before + " " + after;
}
console.log(run(10));
