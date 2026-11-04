// A helper stored on an object that another file exports links the classes: the method above is found through an heir without a look by name.
var util = require("./util.cjs");
function Animal(name) {
  this.name = name;
}
Animal.prototype.speak = function () {
  return this.name + " makes a sound";
};
function Dog(name) {
  Animal.call(this, name);
  this.legs = 4;
}
util.inherits(Dog, Animal);
var dog = new Dog("Rex");
console.log(dog.speak(), dog.legs, dog instanceof Animal, dog.constructor === Dog);
var total = 0;
for (var round = 0; round < 1000; round++) total += dog.speak().length + dog.legs;
console.log(total);
