interface Animal {
  name: string;
  legs: number;
  speak(): string;
}
const base = {
  legs: 4,
  speak(this: Animal) {
    return this.name + " on " + this.legs;
  },
};
function build(name: string): Animal {
  return Object.setPrototypeOf({ name }, base) as unknown as Animal;
}
function describe(animal: Animal) {
  return animal.speak() + "/" + animal.legs + "/" + Object.keys(animal).join() + "/" + Object.hasOwn(animal, "legs");
}
const cat = build("cat");
const bird = build("bird");
bird.legs = 2;
console.log(describe(cat), describe(bird));
base.legs = 6;
console.log(describe(cat), describe(bird), Object.getPrototypeOf(cat) === base);
delete (bird as { legs?: number }).legs;
console.log(describe(bird));
