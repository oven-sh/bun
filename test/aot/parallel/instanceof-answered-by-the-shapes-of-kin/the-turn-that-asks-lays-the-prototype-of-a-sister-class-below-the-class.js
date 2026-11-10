// Object.setPrototypeOf(Dog.prototype, Cat.prototype) is written in the loop that asks, in front of the question: the dogs behind it in the same walk over the list are cats.
// STATISTIC: MissesOfInstanceOfAnsweredByShapesOfKin >= 1
const sizes = JSON.parse("[1,2,3,4,5,6]");
class Animal { constructor(n) { this.n = n; } }
class Cat extends Animal {}
class Dog extends Animal {}
class Puppy extends Dog {}
const animals = sizes.map((n, i) => i % 3 === 0 ? new Cat(n) : i % 3 === 1 ? new Dog(n) : new Puppy(n));
function cats() {
  let sum = 0;
  for (let i = 0; i < animals.length; i++) { if (i === trip) Object.setPrototypeOf(Dog.prototype, Cat.prototype); if (animals[i] instanceof Cat) sum += animals[i].n; }
  return sum;
}
const said = [];
let trip = -1;
for (let turn = 0; turn < 45; turn++) {
  trip = turn === 22 ? 1 : -1;
  if (turn === 36) Object.setPrototypeOf(Dog.prototype, Animal.prototype);
  said.push(cats());
}
console.log(said.join());
