// Between two questions about one object a function that the build does not see lays the prototype of a third class below that of the second.
// STATISTIC: MissesOfInstanceOfAnsweredByShapesOfKin >= 2
const sizes = JSON.parse("[1,2,3,4,5,6,7,8,9]");
class Animal { constructor(n) { this.n = n; } }
class Cat extends Animal {}
class Dog extends Animal {}
class Bird extends Animal {}
const animals = sizes.map((n, i) => (i % 3 === 0 ? new Cat(n) : i % 3 === 1 ? new Dog(n) : new Bird(n)));
const named = text => JSON.parse('"' + text + '"');
const lay = Object[named("setPrototypeOf")];
const deeds = {
  quiet() {},
  change(animal, turn) {
    if (turn === 120 && animal === animals[2]) { lay(Bird.prototype, Dog.prototype); }
    if (turn === 200 && animal === animals[2]) { lay(Bird.prototype, Animal.prototype); }
    return animal;
  },
};
const deed = deeds[named("change")];
const marks = new Int32Array(9), seen = new Array(9).fill(0);
const define = Object[named("defineProperty")];
function count(turn) {
  let sum = 0;
  for (let i = 0; i < animals.length; i++) {
    const animal = animals[i];
    if (animal instanceof Cat) { sum += 1; seen[i] = animal.n; }
    else {
      deed(animal, turn);
      if (animal instanceof Dog) { sum += 10; seen[i] = animal.n; }
      else if (animal instanceof Bird) { sum += 100; seen[i] = animal.n; }
      else { sum += 1000; seen[i] = animal.n; }
      
    }
    marks[i] = sum;
  }
  return sum;
}
const said = [];
for (let turn = 0; turn < 240; turn++) {
  const answer = count(turn);
  if (said[said.length - 1] !== answer) { said.push(turn, answer); for (let i = 0; i < 9; i++) console.log("SAID", turn, i, marks[i] - (i ? marks[i - 1] : 0), typeof seen[i], String(seen[i])); }
}
for (const word of said) console.log("SAID", word);
