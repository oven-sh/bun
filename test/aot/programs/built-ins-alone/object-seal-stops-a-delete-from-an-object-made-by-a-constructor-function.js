function Box() {
  this.value = 1;
}
Box.prototype.next = function () {
  return this.value + 1;
};
const target = new Box();
console.log(target.next());
Object.seal(target);
try {
  delete target.value;
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(target.value, target.next());
