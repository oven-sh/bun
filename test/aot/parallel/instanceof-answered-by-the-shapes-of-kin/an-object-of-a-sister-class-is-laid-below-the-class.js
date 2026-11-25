// Object.setPrototypeOf on ONE object of a sister class, in the middle of the turns: that object alone says yes from then on, and no again when it goes back.
// STATISTIC: InstanceOfMissesDecidedByHierarchy >= 1
const sizes = JSON.parse("[1,2,3,4,5,6]");
class Animal { constructor(n) { this.n = n; } }
class Cat extends Animal {}
class Dog extends Animal {}
const animals = sizes.map((n, i) => i % 2 ? new Cat(n) : new Dog(n));
function cats() {
  let sum = 0;
  for (let i = 0; i < animals.length; i++) if (animals[i] instanceof Cat) sum += animals[i].n;
  return sum;
}
const said = [];
for (let turn = 0; turn < 45; turn++) {
  if (turn === 20) Object.setPrototypeOf(animals[0], Cat.prototype);
  if (turn === 32) Object.setPrototypeOf(animals[0], Dog.prototype);
  if (turn === 38) Object.setPrototypeOf(animals[1], null);
  said.push(cats());
}
console.log(said.join());
