// A method call expects the method that the class declares. After calls have run, the method is replaced, deleted, turned into a getter, or the chain is hung elsewhere, on the class itself and on the class above.
class Animal {
  name = "animal";
  sound(): string {
    return "no sound";
  }
  speak(): string {
    return this.name + ": " + this.sound();
  }
}
class Dog extends Animal {
  name = "dog";
  sound(): string {
    return "woof";
  }
}
class Puppy extends Dog {
  name = "puppy";
}

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function soundOf(animal: Animal): string {
  return animal.sound();
}
function speak(animal: Animal): string {
  return animal.speak();
}
function dogSound(dog: Dog): string {
  return dog.sound();
}

const animal = new Animal();
const dog = new Dog();
const puppy = new Puppy();
const original = Dog.prototype.sound;
let reads = 0;

function look(mark: string): void {
  console.log(mark + ":", attempt(() => soundOf(animal)), attempt(() => soundOf(dog)), attempt(() => soundOf(puppy)), attempt(() => dogSound(dog)), attempt(() => dogSound(puppy)), "|", attempt(() => speak(animal)), attempt(() => speak(dog)), attempt(() => speak(puppy)), attempt(() => speak(new Puppy())));
}

look("at first");
look("again");
Dog.prototype.sound = () => "replaced";
look("replaced on Dog");
Dog.prototype.sound = function (this: Dog) {
  return this.name + "'s own";
};
look("replaced once more");
delete (Dog.prototype as any).sound;
look("deleted from Dog");
Animal.prototype.sound = () => "replaced above";
look("replaced on Animal");
(Puppy.prototype as any).sound = () => "yip";
look("added to Puppy");
delete (Puppy.prototype as any).sound;
Object.defineProperty(Dog.prototype, "sound", {
  get() {
    reads++;
    return () => "read " + reads;
  },
  configurable: true,
});
look("a getter on Dog");
Object.defineProperty(Dog.prototype, "sound", { value: "not a function", writable: true, configurable: true });
look("a text on Dog");
Dog.prototype.sound = original;
look("the original again");
Object.setPrototypeOf(Puppy.prototype, Animal.prototype);
look("Puppy hangs below Animal");
Object.setPrototypeOf(Puppy.prototype, Dog.prototype);
look("Puppy hangs below Dog");
Object.setPrototypeOf(puppy, Animal.prototype);
look("one puppy hangs below Animal");
Object.setPrototypeOf(puppy, { sound: () => "from a literal", speak: Animal.prototype.speak });
look("one puppy hangs below a literal");
Object.setPrototypeOf(puppy, null);
look("one puppy hangs nowhere");
Object.setPrototypeOf(puppy, Puppy.prototype);
look("as at first, but for Animal");
Animal.prototype.speak = function (this: Animal) {
  return "spoken otherwise: " + this.sound();
};
look("speak replaced");

export {};
