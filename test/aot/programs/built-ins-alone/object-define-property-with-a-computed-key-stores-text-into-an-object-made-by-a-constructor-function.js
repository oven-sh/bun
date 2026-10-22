function Box() {
  this.value = 1;
}
Box.prototype.next = function () {
  return this.value + 1;
};
const target = new Box();
console.log(target.next());
const key = ["val", "ue"].join("");
Object.defineProperty(target, key, { value: "text" });
console.log(typeof target.value, target.value.length, target.next());
