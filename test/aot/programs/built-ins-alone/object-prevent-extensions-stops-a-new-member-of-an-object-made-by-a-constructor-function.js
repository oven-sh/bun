function Box() {
  this.value = 1;
}
Box.prototype.next = function () {
  return this.value + 1;
};
const target = new Box();
console.log(target.next());
Object.preventExtensions(target);
try {
  target.added = 2;
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(target.added === undefined, Object.keys(target).join(), target.next());
