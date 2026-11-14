// The link of the class at the top of the family changes: Object.setPrototypeOf(Animal.prototype, Marked.prototype), and Marked stands in another family.
const sizes = JSON.parse("[1,2,3,4]");
class Marked {}
class Stamped extends Marked {}
class Animal { constructor(n) { this.n = n; } }
class Cat extends Animal {}
class Dog extends Animal {}
const things = sizes.map((n, i) => i % 2 ? new Cat(n) : new Dog(n));
things.push(new Stamped(), new Marked());
function marked() {
  let count = 0;
  for (let i = 0; i < things.length; i++) { if (things[i] instanceof Marked) count += 10; if (things[i] instanceof Stamped) count += 1; if (things[i] instanceof Cat) count += 100; }
  return count;
}
const said = [];
for (let turn = 0; turn < 40; turn++) {
  if (turn === 21) Object.setPrototypeOf(Animal.prototype, Marked.prototype);
  said.push(marked());
}
console.log(said.join());
