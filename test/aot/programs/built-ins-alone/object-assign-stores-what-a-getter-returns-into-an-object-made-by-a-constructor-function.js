function Box() {
  this.value = 1;
}
Box.prototype.next = function () {
  return this.value + 1;
};
const target = new Box();
console.log(target.next());
const source = {
  get value() {
    return "text";
  },
};
Object.assign(target, source);
console.log(typeof target.value, target.value.length, target.next());
