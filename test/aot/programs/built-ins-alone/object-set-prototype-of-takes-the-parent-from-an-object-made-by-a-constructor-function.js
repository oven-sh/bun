function Box() {
  this.value = 1;
}
Box.prototype.next = function () {
  return this.value + 1;
};
const target = new Box();
console.log(target.next());
Object.setPrototypeOf(target, null);
console.log(typeof target.next, typeof target.toString, target.value + 1);
