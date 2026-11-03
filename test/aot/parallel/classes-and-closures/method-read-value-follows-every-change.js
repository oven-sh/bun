// The read is in one function that runs before and after each change, so that what was right once has to be given up.
class Animal {
  speak() {
    return "animal";
  }
  walk() {
    return "walks";
  }
}
class Dog extends Animal {
  fetch() {
    return "fetches";
  }
}
const lines = [];
function look(o) {
  const speak = o.speak;
  const walk = o.walk;
  const fetch = o.fetch;
  return (typeof speak === "function" ? speak.call(o) : String(speak)) + " " + (typeof walk === "function" ? walk.call(o) : String(walk)) + " " + (typeof fetch === "function" ? fetch.call(o) : String(fetch));
}
function isOriginal(o, speak, walk) {
  return (o.speak === speak) + " " + (o.walk === walk);
}
const { speak, walk } = Animal.prototype;
const dog = new Dog();
const other = new Dog();
function round(name) {
  for (let i = 0; i < 3; i++) look(dog);
  lines.push(name + ": " + look(dog) + " | " + look(other) + " | " + isOriginal(dog, speak, walk) + " | " + isOriginal(other, speak, walk));
}
round("at first");
dog.speak = function () {
  return "own";
};
round("an own property");
delete dog.speak;
round("deleted again");
Dog.prototype.speak = function () {
  return "dog";
};
round("the class below gets one");
delete Dog.prototype.speak;
round("and loses it");
Animal.prototype.speak = function () {
  return "changed";
};
round("the method is replaced");
Animal.prototype.speak = speak;
round("and put back");
Object.defineProperty(Animal.prototype, "walk", { get() { return () => "from a getter"; }, configurable: true });
round("a getter in its place");
Object.defineProperty(Animal.prototype, "walk", { value: walk, writable: true, configurable: true });
round("the method again");
delete Animal.prototype.walk;
round("deleted");
Animal.prototype.walk = walk;
round("stored again");
Object.setPrototypeOf(other, { speak() { return "stranger"; } });
round("another prototype for one object");
Object.setPrototypeOf(Dog.prototype, { speak() { return "new parent"; }, walk() { return "strolls"; } });
round("another parent for the class");
Object.setPrototypeOf(Dog.prototype, Animal.prototype);
round("the old parent again");
Dog.prototype.fetch = 5;
round("a number in place of a method");
console.log(lines.join("\n"));
