// The first question leaves the object known as one of the kin that stands where it was made. Between the two questions a function that the build does not see lays that very object below the second class.
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
    if (turn === 120 && animal === animals[2]) lay(animal, Dog.prototype);
    if (turn === 160 && animal === animals[5]) lay(animal, Cat.prototype);
    if (turn === 200 && animal === animals[2]) lay(animal, Bird.prototype);
  },
};
const deed = deeds[named("change")];
function count(turn) {
  let sum = 0;
  for (let i = 0; i < animals.length; i++) {
    const animal = animals[i];
    if (animal instanceof Cat) sum += 1;
    else {
      deed(animal, turn);
      if (animal instanceof Dog) sum += 10;
      else if (animal instanceof Bird) sum += 100;
      else sum += 1000;
    }
  }
  return sum;
}
const said = [];
for (let turn = 0; turn < 240; turn++) {
  const answer = count(turn);
  if (said[said.length - 1] !== answer) said.push(turn, answer);
}
console.log(said.join());
