// A sister class is evaluated only in the middle of the turns, with a parent that is not the one written at first sight.
const sizes = JSON.parse("[1,2,3,4]");
class Animal { constructor(n) { this.n = n; } }
class Cat extends Animal {}
class Dog extends Animal {}
let Parent = Animal;
const animals = sizes.map((n, i) => i % 2 ? new Cat(n) : new Dog(n));
function cats() {
  let sum = 0;
  for (let i = 0; i < animals.length; i++) if (animals[i] instanceof Cat) sum += animals[i].n;
  return sum;
}
const said = [];
for (let turn = 0; turn < 40; turn++) {
  if (turn === 18) { Parent = Cat; }
  if (turn === 20) { class Late extends Parent {} animals.push(new Late(50)); }
  said.push(cats());
}
console.log(said.join());
