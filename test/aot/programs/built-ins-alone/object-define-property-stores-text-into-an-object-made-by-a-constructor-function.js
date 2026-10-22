function Box() {
  this.value = 1;
}
Box.prototype.next = function () {
  return this.value + 1;
};
const target = new Box();
console.log(target.next());
Object.defineProperty(target, "value", { value: "text" });
console.log(typeof target.value, target.value.length, target.next());
