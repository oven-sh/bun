// Symbol.hasInstance laid on the class, then on the class above it, in the middle of the turns.
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
  if (turn === 20) Object.defineProperty(Animal, Symbol.hasInstance, { value: thing => thing.n > 4, configurable: true });
  if (turn === 30) Object.defineProperty(Cat, Symbol.hasInstance, { value: thing => thing.n < 3, configurable: true });
  if (turn === 38) { delete Cat[Symbol.hasInstance]; delete Animal[Symbol.hasInstance]; }
  said.push(cats());
}
console.log(said.join());
