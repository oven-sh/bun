// x instanceof C for classes that are also handed about as values, so that their instances may be given another prototype: by Object.setPrototypeOf, __proto__, Reflect.construct with another new.target, Object.create; in loops and outside; then with Symbol.hasInstance defined on the class.
class Animal {
  legs = 4;
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}
class Dog extends Animal {
  barks = true;
}
class Puppy extends Dog {
  age = 1;
}
class Stone {
  weight = 9;
}
class Alone {
  value = 1;
}
const handedAbout: any[] = [Animal, Dog, Puppy, Stone, Alone];
const lines: string[] = [];

function isAnimal(x: unknown) {
  return x instanceof Animal;
}
function isDog(x: unknown) {
  return x instanceof Dog;
}
function isPuppy(x: unknown) {
  return x instanceof Puppy;
}
function isStone(x: unknown) {
  return x instanceof Stone;
}
function isAlone(x: unknown) {
  return x instanceof Alone;
}
function typedIsDog(x: Animal) {
  return x instanceof Dog;
}
function typedIsAlone(x: Alone | Stone) {
  return x instanceof Alone;
}
function countInLoop(all: unknown[]) {
  let animals = 0, dogs = 0, puppies = 0, stones = 0, alone = 0;
  for (let round = 0; round < 3; round++) {
    for (const x of all) {
      if (x instanceof Animal) animals++;
      if (x instanceof Dog) dogs++;
      if (x instanceof Puppy) puppies++;
      if (x instanceof Stone) stones++;
      if (x instanceof Alone) alone++;
    }
  }
  return [animals, dogs, puppies, stones, alone].join();
}
function countTypedInLoop(all: Animal[]) {
  let dogs = 0, puppies = 0;
  for (let round = 0; round < 3; round++) {
    for (const x of all) {
      if (x instanceof Dog) dogs++;
      if (x instanceof Puppy) puppies++;
    }
  }
  return dogs + "," + puppies;
}
function tell(what: string, x: unknown) {
  lines.push(what + ": " + [isAnimal(x), isDog(x), isPuppy(x), isStone(x), isAlone(x)].map(Number).join("") + " in a loop " + countInLoop([x]));
}

const animal = new Animal("a"), dog = new Dog("d"), puppy = new Puppy("p"), stone = new Stone(), alone = new Alone();
tell("an animal", animal);
tell("a dog", dog);
tell("a puppy", puppy);
tell("a stone", stone);
tell("alone", alone);
for (const x of [undefined, null, 0, 1.5, "text", true, Symbol.iterator, 1n, {}, [], () => {}, Animal, Animal.prototype, Dog.prototype, Object.create(null)]) tell(typeof x === "symbol" ? "a symbol" : typeof x === "bigint" ? "a bigint" : typeof x + " " + (typeof x === "function" ? x.name : JSON.stringify(x)), x);

tell("made with Object.create(Animal.prototype)", Object.create(Animal.prototype));
tell("made with Object.create(Puppy.prototype)", Object.create(Puppy.prototype));
tell("made with Object.create(a dog)", Object.create(dog));
tell("a literal with __proto__ Stone.prototype", { __proto__: Stone.prototype });
tell("Reflect.construct(Animal, .., Stone)", Reflect.construct(Animal, ["r"], Stone));
tell("Reflect.construct(Stone, .., Puppy)", Reflect.construct(Stone, [], Puppy));
tell("Reflect.construct(Alone, .., Object)", Reflect.construct(Alone, [], Object));
tell("Reflect.construct(Dog, .., a function without a class)", Reflect.construct(Dog, ["r"], function Other() {}));
tell("a proxy of a dog", new Proxy(dog, {}));
tell("a proxy that names another prototype", new Proxy(stone, { getPrototypeOf: () => Puppy.prototype }));

const changed = new Dog("changed");
tell("a dog before", changed);
Object.setPrototypeOf(changed, Stone.prototype);
tell("the dog with Stone.prototype", changed);
lines.push("typed: " + typedIsDog(changed) + " " + countTypedInLoop([changed, dog, puppy, animal]));
Object.setPrototypeOf(changed, Animal.prototype);
tell("the dog with Animal.prototype", changed);
Object.setPrototypeOf(changed, Puppy.prototype);
tell("the dog with Puppy.prototype", changed);
Object.setPrototypeOf(changed, null);
tell("the dog without a prototype", changed);
Object.setPrototypeOf(changed, Dog.prototype);
tell("the dog with its own again", changed);
lines.push("its fields: " + changed.legs + " " + changed.name + " " + changed.barks);

const single = new Alone();
(single as any).__proto__ = Stone.prototype;
tell("alone with Stone.prototype by __proto__", single);
lines.push("typed: " + typedIsAlone(single) + " " + typedIsAlone(alone) + " " + typedIsAlone(stone));
const heavy = new Stone();
Object.setPrototypeOf(heavy, alone);
tell("a stone whose prototype is an instance of Alone", heavy);
const between = Object.create(Dog.prototype);
const far = new Stone();
Object.setPrototypeOf(far, between);
tell("a stone behind an object behind Dog.prototype", far);

lines.push("all: " + countInLoop([animal, dog, puppy, stone, alone, changed, single, heavy, far, null, 5, {}]));

for (const which of handedAbout) lines.push(which.name + " " + (new which("n") instanceof which));

Object.defineProperty(Stone, Symbol.hasInstance, { value: (x: unknown) => typeof x === "number", configurable: true });
tell("a stone, Stone[Symbol.hasInstance] takes numbers", stone);
tell("a number", 7);
delete (Stone as any)[Symbol.hasInstance];
tell("a stone, Symbol.hasInstance deleted", stone);
Object.defineProperty(Animal, Symbol.hasInstance, { value: () => true, configurable: true });
tell("a stone, Animal[Symbol.hasInstance] takes all (Dog and Puppy inherit it)", stone);
console.log(lines.join("\n"));
