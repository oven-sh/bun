// No call is written in the turn: a getter that the turn reads changes the link.
// STATISTIC: MissesOfInstanceOfAnsweredByShapesOfKin >= 1
const sizes = JSON.parse("[1,2,3,4,5,6,7,8]");
class Animal { constructor(n) { this.n = n; } }
class Cat extends Animal {}
class Dog extends Animal {}
const animals = sizes.map((n, i) => i % 2 ? new Cat(n) : new Dog(n));
let reads = 0;
Object.defineProperty(animals[2], "tag", { get() { if (++reads === 22) Object.setPrototypeOf(Dog.prototype, Cat.prototype); return 1; } });
function cats() {
  let sum = 0;
  for (let i = 0; i < animals.length; i++) {
    const animal = animals[i];
    if (animal.tag) sum += 100;
    if (animal instanceof Cat) sum += animal.n;
  }
  return sum;
}
const said = [];
for (let turn = 0; turn < 40; turn++) said.push(cats());
console.log(said.join());
