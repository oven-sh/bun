// `var made = Object.create(parent.prototype); made.constructor = child; child.prototype = made;` in a helper links the classes: the method above is found through an heir without a look by name.
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
function link(child, parent) {
  var made = Object.create(parent.prototype);
  made.constructor = child;
  child.prototype = made;
}
link(Dog, Animal);
var dog = new Dog("Rex");
console.log(dog.speak(), dog.legs, dog instanceof Animal, dog.constructor === Dog);
var total = 0;
for (var round = 0; round < 1000; round++) total += dog.speak().length + dog.legs;
console.log(total);
