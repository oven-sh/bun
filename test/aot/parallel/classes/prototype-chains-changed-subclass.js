// What a name finds on an instance follows every change to the prototype chain: made before the class below is defined or has its first instance, and after.
function Base() {
  this.own = "own";
}
Base.prototype.greet = function () {
  return "Base.greet";
};
Base.prototype.shared = function () {
  return "Base.shared";
};
function Middle() {
  Base.call(this);
}
Object.setPrototypeOf(Middle.prototype, Base.prototype);
Middle.prototype.middle = function () {
  return "Middle.middle";
};
function Leaf() {
  Middle.call(this);
}
Object.setPrototypeOf(Leaf.prototype, Middle.prototype);
function OtherLeaf() {
  Middle.call(this);
}
Object.setPrototypeOf(OtherLeaf.prototype, Middle.prototype);

function describe(object) {
  return [object.greet(), object.shared(), typeof object.middle === "function" ? object.middle() : "none", String(object.absent), String(object.late), object.own].join(" | ");
}

console.log("base", describe(new Base()));
Base.prototype.greet = function () {
  return "Base.greet replaced before Middle has an instance";
};
console.log("middle", describe(new Middle()));
Middle.prototype.shared = function () {
  return "Middle.shared added before Leaf has an instance";
};
Base.prototype.late = "Base.late";
console.log("leaf", describe(new Leaf()));
console.log("middle", describe(new Middle()));
console.log("base", describe(new Base()));
Middle.prototype.absent = "Middle.absent added after Leaf has an instance";
console.log("leaf", describe(new Leaf()));
delete Middle.prototype.shared;
console.log("leaf", describe(new Leaf()));
console.log("other leaf", describe(new OtherLeaf()));
Object.setPrototypeOf(Middle.prototype, {
  greet() {
    return "another parent";
  },
  shared() {
    return "another parent";
  },
});
console.log("leaf", describe(new Leaf()));
console.log("other leaf", describe(new OtherLeaf()));

class Animal {
  name() {
    return "Animal.name";
  }
  sound() {
    return "Animal.sound";
  }
}
function say(animal) {
  return [animal.name(), animal.sound(), String(animal.legs), String(animal.tail)].join(" | ");
}
console.log("animal", say(new Animal()));
Animal.prototype.sound = function () {
  return "Animal.sound replaced before Dog is defined";
};
Animal.prototype.legs = 4;
class Dog extends Animal {
  name() {
    return "Dog.name";
  }
}
console.log("dog", say(new Dog()));
Dog.prototype.tail = "Dog.tail added before Puppy is defined";
class Puppy extends Dog {}
console.log("puppy", say(new Puppy()));
Object.defineProperty(Dog.prototype, "legs", {
  get() {
    return "a getter on Dog.prototype";
  },
  configurable: true,
});
console.log("puppy", say(new Puppy()));
console.log("dog", say(new Dog()));
console.log("animal", say(new Animal()));
class Kitten extends Animal {}
console.log("kitten", say(new Kitten()));
