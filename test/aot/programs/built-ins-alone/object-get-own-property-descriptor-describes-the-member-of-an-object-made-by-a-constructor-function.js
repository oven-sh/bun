function Box() {
  this.value = 1;
}
Box.prototype.next = function () {
  return this.value + 1;
};
const target = new Box();
console.log(target.next());
const descriptor = Object.getOwnPropertyDescriptor(target, "value");
console.log(descriptor.value + 1, descriptor.writable, descriptor.enumerable, descriptor.get === undefined);
