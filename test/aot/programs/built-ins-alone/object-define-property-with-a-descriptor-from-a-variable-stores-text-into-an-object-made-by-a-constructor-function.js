function Box() {
  this.value = 1;
}
Box.prototype.next = function () {
  return this.value + 1;
};
const target = new Box();
console.log(target.next());
const descriptor = { value: "text" };
Object.defineProperty(target, "value", descriptor);
console.log(typeof target.value, target.value.length, target.next());
