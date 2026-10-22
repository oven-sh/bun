function Box() {
  this.value = 1;
}
Box.prototype.next = function () {
  return this.value + 1;
};
const target = new Box();
console.log(target.next());
Object.freeze(target);
try {
  target.value = 2;
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(target.value, target.next(), Object.isFrozen(target));
