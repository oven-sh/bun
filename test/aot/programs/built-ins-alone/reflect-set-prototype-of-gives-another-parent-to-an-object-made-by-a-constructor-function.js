function Box() {
  this.value = 1;
}
Box.prototype.next = function () {
  return this.value + 1;
};
const target = new Box();
console.log(target.next());
Reflect.setPrototypeOf(target, { extra: "text" });
console.log(typeof target.extra, target.extra.length, typeof target.next, target.value + 1);
