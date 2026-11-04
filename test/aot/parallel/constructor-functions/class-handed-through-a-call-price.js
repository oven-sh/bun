// A class that is handed through a call which returns it is a parent: the method above is found through an heir without a look by name.
"use strict";
function finish(made, members) {
  if (members) members.length = 0;
  return made;
}
function inherits(child, parent) {
  child.prototype = Object.create(parent && parent.prototype, {
    constructor: { value: child, writable: true, configurable: true },
  });
  if (parent) Object.setPrototypeOf(child, parent);
}
var Animal = /*#__PURE__*/ (function () {
  function Animal(name) {
    this.name = name;
  }
  Animal.prototype.speak = function () {
    return this.name + " makes a sound";
  };
  return finish(Animal, []);
})();
var Dog = /*#__PURE__*/ (function (_Animal) {
  function Dog(name) {
    _Animal.call(this, name);
    this.legs = 4;
  }
  inherits(Dog, _Animal);
  return finish(Dog);
})(Animal);
var dog = new Dog("Rex");
console.log(dog.speak(), dog.legs, dog instanceof Animal, dog.constructor === Dog);
var total = 0;
for (var round = 0; round < 1000; round++) total += dog.speak().length + dog.legs;
console.log(total);
