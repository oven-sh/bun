function attempt(label, run) {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

class Animal {
  constructor() {
    this.legs = 4;
  }
}
class Dog extends Animal {
  constructor() {
    super();
    this.tricks = 1;
  }
}
class Rock {
  constructor() {
    this.weight = 9;
  }
}
function OldStyle() {
  this.old = true;
}

function isAnimal(value) {
  return value instanceof Animal;
}
function isDog(value) {
  return value instanceof Dog;
}
function isOldStyle(value) {
  return value instanceof OldStyle;
}
function isInstanceOf(value, constructor) {
  return value instanceof constructor;
}
function countAnimals(list) {
  let count = 0;
  for (let i = 0; i < list.length; i++) if (list[i] instanceof Animal) count++;
  return count;
}

const honest = [];
for (let i = 0; i < 2000; i++) honest.push(i % 3 === 0 ? new Animal() : i % 3 === 1 ? new Dog() : new Rock());
let yes = 0;
for (const value of honest) yes += isAnimal(value) + isDog(value) + isOldStyle(value) + isInstanceOf(value, Rock);
console.log("2000 honest values:", yes, countAnimals(honest));
for (let i = 0; i < 2000; i++) isOldStyle(new OldStyle());

function ask(label, value) {
  attempt(label + " instanceof Animal:", () => isAnimal(value));
  attempt(label + " instanceof Dog:", () => isDog(value));
  attempt(label + " instanceof OldStyle:", () => isOldStyle(value));
  attempt(label + " counted:", () => countAnimals([value]));
}

const loose = new Dog();
ask("a dog", loose);
Object.setPrototypeOf(loose, null);
ask("a dog without a prototype", loose);
Object.setPrototypeOf(loose, Rock.prototype);
ask("a dog under the prototype of Rock", loose);
Object.setPrototypeOf(loose, OldStyle.prototype);
ask("a dog under the prototype of OldStyle", loose);
Object.setPrototypeOf(loose, Dog.prototype);
ask("a dog under its own prototype again", loose);

const risen = new Rock();
Object.setPrototypeOf(risen, Dog.prototype);
ask("a rock under the prototype of Dog", risen);
ask("an object made by Object.create(Dog.prototype)", Object.create(Dog.prototype));
ask("the prototype object of Dog", Dog.prototype);
ask("a proxy of a dog", new Proxy(new Dog(), {}));
ask(
  "a proxy that answers another prototype",
  new Proxy(new Rock(), {
    getPrototypeOf: () => Animal.prototype,
  }),
);
for (const primitive of [1, "dog", null, undefined, true, 1n, Symbol.iterator])
  ask("the primitive " + String(primitive), primitive);

const kept = new Dog();
Object.setPrototypeOf(Dog.prototype, Rock.prototype);
ask("a dog after Dog.prototype moved under Rock.prototype", kept);
attempt("  which is now a rock:", () => isInstanceOf(kept, Rock));
Object.setPrototypeOf(Dog.prototype, Animal.prototype);
ask("a dog after it moved back", kept);

const before = new OldStyle();
OldStyle.prototype = { replaced: true };
const after = new OldStyle();
ask("made before OldStyle.prototype was replaced", before);
ask("made after OldStyle.prototype was replaced", after);
OldStyle.prototype = 5;
ask("while OldStyle.prototype is a number", after);
OldStyle.prototype = Object.getPrototypeOf(after);
ask("with the second prototype again", after);

let asked = 0;
Object.defineProperty(Animal, Symbol.hasInstance, {
  value(value) {
    asked++;
    return value === 7;
  },
  configurable: true,
});
ask("with Symbol.hasInstance on Animal, a dog", kept);
ask("with Symbol.hasInstance on Animal, seven", 7);
console.log("Symbol.hasInstance ran", asked, "times");
delete Animal[Symbol.hasInstance];
ask("without it again, a dog", kept);

const rights = {
  "a bound class": Animal.bind(null),
  "a proxy of a class": new Proxy(Animal, {}),
  "an arrow function": () => {},
  "a plain object": {},
  "an object with Symbol.hasInstance": { [Symbol.hasInstance]: value => value === kept },
  "a number": 3,
  undefined: undefined,
  Object: Object,
  Function: Function,
};
for (const [name, right] of Object.entries(rights))
  attempt("a dog instanceof " + name + ":", () => isInstanceOf(kept, right));
console.log("honest again:", countAnimals(honest));
