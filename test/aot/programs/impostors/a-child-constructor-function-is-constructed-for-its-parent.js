function Old(x, y) {
  this.x = x;
  this.y = y;
}
function Child(x, y) {
  Old.call(this, x, y);
  this.z = 3;
}
Child.prototype = Object.create(Old.prototype);
Child.prototype.constructor = Child;

const made = Reflect.construct(Child, [1, 2], Old);
console.log("keys", Object.keys(made).join());
console.log("x", made.x);
console.log("y", made.y);
console.log("z", made.z);
console.log("prototype is that of the parent", Object.getPrototypeOf(made) === Old.prototype);
