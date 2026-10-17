// asks whether an object is an instance of a class
class Animal {
  constructor(public legs: number) {}
}
class Dog extends Animal {}
class Bird extends Animal {}
const operations = 100;
const animals: Animal[] = [];
for (let i = 0; i < operations; i++) animals.push(i & 1 ? new Dog(4) : new Bird(2));
let total = 0;

kernel: {
  let dogs = 0;
  for (let i = 0; i < animals.length; i++) if (animals[i] instanceof Dog) dogs += 1;
  total += dogs;
}

console.log(total);
