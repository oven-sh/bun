class Animal {
  legs = 4;
}

class Dog extends Animal {
  tricks = 2;
}

function legsOf(animals: Animal[]): number {
  let total = 0;
  for (let i = 0; i < animals.length; i++) total += animals[i].legs;
  return total;
}

function tricksOf(dogs: Dog[]): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].tricks;
  return total;
}

function aListOfDogsAsAListOfAnimals(): () => number {
  const dogs: Dog[] = [];
  for (let i = 0; i < 100; i++) dogs.push(new Dog());
  const animals: Animal[] = dogs;
  return function turnOfAListOfDogsAsAListOfAnimals() {
    return legsOf(animals) + tricksOf(dogs);
  };
}

function sumOfArrayLike(values: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
}

function sumOfNumbers(values: number[]): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
}

function arraysForArrayLikes(): () => number {
  const made = Array.from({ length: 100 }, (_, i) => i);
  return function turnOfArraysForArrayLikes() {
    return sumOfArrayLike(made) + sumOfNumbers(made);
  };
}

export const cases = {
  "7 a list of dogs as a list of animals": aListOfDogsAsAListOfAnimals,
  "10 arrays for array-likes and lists of numbers": arraysForArrayLikes,
};
