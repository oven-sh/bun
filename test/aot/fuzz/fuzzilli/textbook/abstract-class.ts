abstract class Animal {
  constructor(readonly name: string) {}
  abstract sound(): string;
  speak(): string {
    return this.name + " says " + this.sound();
  }
}
class Cow extends Animal {
  sound() {
    return "moo";
  }
}
class Owl extends Animal {
  sound() {
    return "hoo";
  }
}
const animals: Animal[] = [new Cow("bess"), new Owl("olly")];
console.log(animals.map(animal => animal.speak()).join());
