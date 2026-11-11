// Object.setPrototypeOf(Dog.prototype, Cat.prototype) in the middle of the turns: every dog is a cat from then on.
// STATISTIC: InstanceOfMissesDecidedByHierarchy >= 1
const sizes = JSON.parse("[1,2,3,4,5,6]");
class Animal { constructor(n) { this.n = n; } }
class Cat extends Animal {}
class Dog extends Animal {}
class Puppy extends Dog {}
const animals = sizes.map((n, i) => i % 3 === 0 ? new Cat(n) : i % 3 === 1 ? new Dog(n) : new Puppy(n));
function cats() {
  let sum = 0;
  for (let i = 0; i < animals.length; i++) if (animals[i] instanceof Cat) sum += animals[i].n;
  return sum;
}
const said = [];
for (let turn = 0; turn < 45; turn++) {
  if (turn === 22) Object.setPrototypeOf(Dog.prototype, Cat.prototype);
  if (turn === 36) Object.setPrototypeOf(Dog.prototype, Animal.prototype);
  said.push(cats());
}
console.log(said.join());
