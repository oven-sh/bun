// Flags: --aot-check=verify-each-pass
// Cat has no written constructor: `constructor(...args) { super(...args) }` is put in line with a read of its fresh list whose storage is not decided yet. The read runs no code, so the test of `dogs` in front of it holds behind it.
class Animal { name: string; constructor(name: string) { this.name = name; } }
class Dog extends Animal { legs = 4; }
class Cat extends Animal { lives = "nine"; }
function heldInALocal(dogs: Dog[], animals: Animal[]): unknown[] { const dog = dogs[0]; animals[0] = new Cat("tom"); return [dog.legs, dogs[0].legs, dog === dogs[0]]; }
const dogs: Dog[] = [];
for (let i = 0; i < 4000; i++) dogs.push(new Dog("d" + i));
let total = 0;
for (let i = 0; i < 3000; i++) total += heldInALocal(dogs, []).length;
console.log(total, String(heldInALocal(dogs, dogs)));
export {};
