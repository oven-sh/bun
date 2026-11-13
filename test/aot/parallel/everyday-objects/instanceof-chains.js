// instanceof over classes made in two ways, and one with its own test
class Animal {}
class Dog extends Animal {}
function Old() {}
Old.prototype = Object.create(Dog.prototype);
class Even {
  static [Symbol.hasInstance](value) {
    return value % 2 === 0;
  }
}
function kinds(numbers) {
  const out = [];
  for (const value of [new Dog(), new Animal(), new Old(), {}]) out.push([Animal, Dog, Old].map(type => (value instanceof type ? 1 : 0)).join(""));
  for (const number of numbers) out.push(number instanceof Even);
  return out.join(" ");
}
console.log(kinds([1, 2]));
console.log(kinds([10, 11, 12]));
console.log(kinds([]));
