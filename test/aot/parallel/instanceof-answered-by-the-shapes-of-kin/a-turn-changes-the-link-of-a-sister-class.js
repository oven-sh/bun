// The link changes INSIDE a turn of the loop that asks: the objects behind it in the same walk over the list answer by the new chain.
// STATISTIC: InstanceOfMissesDecidedByHierarchy >= 1
const sizes = JSON.parse("[1,2,3,4,5,6,7,8]");
class Animal { constructor(n) { this.n = n; } }
class Cat extends Animal {}
class Dog extends Animal {}
const animals = sizes.map((n, i) => i % 2 ? new Cat(n) : new Dog(n));
const hooks = {
  quiet() {},
  lay(turn, i) { if (turn === 21 && i === 3) Object.setPrototypeOf(Dog.prototype, Cat.prototype); if (turn === 30 && i === 5) Object.setPrototypeOf(Dog.prototype, Animal.prototype); if (turn === 35 && i === 1) Object.setPrototypeOf(animals[6], Cat.prototype); },
};
const hook = hooks[JSON.parse('["lay"]')[0]];
function cats(turn) {
  let sum = 0;
  for (let i = 0; i < animals.length; i++) {
    hook(turn, i);
    if (animals[i] instanceof Cat) sum += animals[i].n;
  }
  return sum;
}
const said = [];
for (let turn = 0; turn < 42; turn++) said.push(cats(turn));
console.log(said.join());
