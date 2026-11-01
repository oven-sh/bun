// Flags: --aot-check=verify-each-pass
class Animal { name: string; constructor(name: string) { this.name = name; } }
class Dog extends Animal { legs = 4; }
class Cat extends Animal { lives = "nine"; }
class Kennel { held(dogs: Dog[], animals: Animal[]): unknown[] { const dog = dogs[0]; animals[0] = new Cat("tom"); return [dog.legs, dogs[0].legs, dog === dogs[0]]; } }
const kennel = new Kennel();
const dogs: Dog[] = [];
for (let i = 0; i < 4000; i++) dogs.push(new Dog("d" + i));
let total = 0;
for (let i = 0; i < 3000; i++) total += kennel.held(dogs, []).length;
console.log(total, String(kennel.held(dogs, dogs)));
export {};
