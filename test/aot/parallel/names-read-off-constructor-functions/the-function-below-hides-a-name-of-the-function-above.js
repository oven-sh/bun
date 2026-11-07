function Animal() {} Animal.create = function () { return 1; };
function Dog() {} Object.setPrototypeOf(Dog, Animal);
globalThis.Dog = Dog; globalThis.Animal = Animal;
function run(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    if (i === 3) (0, eval)("Animal.create = function () { return 10; }");
    if (i === 6) (0, eval)("Dog.create = function () { return 100; }");
    if (i === 8) (0, eval)("delete Dog.create");
    sum += Dog.create();
  }
  return sum;
}
console.log(run(10));
