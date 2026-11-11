// An object of one class stands below a plain object that stands below the class's prototype: nothing is hidden on the way. Later the plain object is laid below the prototype of a sister class.
// STATISTIC: InstanceOfMissesDecidedByHierarchy >= 1
const sizes = JSON.parse("[1,2,3,4,5,6]");
class Animal { constructor(n) { this.n = n; } }
class Cat extends Animal {}
class Dog extends Animal {}
const animals = sizes.map((n, i) => (i % 2 ? new Cat(n) : new Dog(n)));
const named = text => JSON.parse('"' + text + '"');
const lay = Object[named("setPrototypeOf")], create = Object[named("create")];
const between = create(Dog.prototype);
lay(animals[0], between);
const made = create(between);
made.n = 50;
animals.push(made);
function cats() {
  let sum = 0;
  for (let i = 0; i < animals.length; i++) if (animals[i] instanceof Cat) sum += animals[i].n;
  return sum;
}
function dogs() {
  let sum = 0;
  for (let i = 0; i < animals.length; i++) if (animals[i] instanceof Dog) sum += animals[i].n;
  return sum;
}
const said = [];
for (let turn = 0; turn < 300; turn++) {
  if (turn === 100) lay(between, Cat.prototype);
  if (turn === 200) lay(between, Animal.prototype);
  const answer = cats() * 1000 + dogs();
  if (said[said.length - 1] !== answer) said.push(turn, answer);
}
console.log(said.join());
