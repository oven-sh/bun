function Box() {
  this.value = 1;
}
Box.prototype.next = function () {
  return this.value + 1;
};
const target = new Box();
console.log(target.next());
Reflect.set({}, "value", "text", target);
console.log(typeof target.value, target.value.length, target.next());
