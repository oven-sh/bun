function Box() {
  this.value = 1;
}
Box.prototype.next = function () {
  return this.value + 1;
};
const target = new Box();
console.log(target.next());
Object.defineProperty(target, "value", { writable: false });
try {
  target.value = 2;
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(target.value, target.next());
