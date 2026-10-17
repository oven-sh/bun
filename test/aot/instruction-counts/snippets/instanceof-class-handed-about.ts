// asks whether a value is an instance of a class that is also handed about as a value
class Animal {
  constructor(public legs: number) {}
}
class Stone {
  constructor(public weight: number) {}
}
const handedAbout: unknown[] = [Animal, Stone];
function isAnimal(value: unknown): boolean {
  return value instanceof Animal;
}
const operations = 100;
const things: unknown[] = [];
for (let i = 0; i < operations; i++) things.push(i & 1 ? new Animal(4) : new Stone(2));
let total = handedAbout.length;

kernel: {
  let animals = 0;
  for (let i = 0; i < things.length; i++) if (isAnimal(things[i])) animals += 1;
  total += animals;
}

console.log(total);
