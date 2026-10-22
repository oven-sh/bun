// The receiver has the type Cat | Dog | Fish | null: three classes that are no relatives, with a method of one name that takes different parameters. It is tested for null, or called with `?.`. Then the methods are replaced, one class after the other.
class Cat {
  lives = 9;
  sound(): number {
    return this.lives;
  }
}
class Dog {
  constructor(public weight: number) {}
  sound(times = 2): number {
    return this.weight * times;
  }
}
class Puppy extends Dog {
  sound(times = 3): number {
    return super.sound(times) + 1;
  }
}
class Fish {
  sound(): number {
    return 0;
  }
}

type Pet = Cat | Dog | Fish | null;

function soundOf(pet: Pet): number {
  return pet === null ? -4 : pet.sound();
}
function optional(pet: Pet | undefined): number {
  return pet?.sound() ?? -5;
}
function chorus(pets: Pet[]): number {
  let sum = 0;
  for (const pet of pets) if (pet) sum = sum * 10 + pet.sound();
  return sum;
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const pets: Pet[] = [new Cat(), null, new Dog(2), new Puppy(1), new Fish(), null];

function round(): void {
  for (const pet of pets) note("tested for null", soundOf(pet));
  for (const pet of pets) note("an optional call", optional(pet));
  note("an optional call on undefined", optional(undefined));
  note("all", chorus(pets));
}

round();
Cat.prototype.sound = () => 1;
round();
Dog.prototype.sound = () => 2;
round();
Fish.prototype.sound = () => 3;
Reflect.deleteProperty(Puppy.prototype, "sound");
round();

export {};
