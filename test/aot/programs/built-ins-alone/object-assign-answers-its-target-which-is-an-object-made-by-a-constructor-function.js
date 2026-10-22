function Box() {
  this.value = 1;
}
Box.prototype.next = function () {
  return this.value + 1;
};
const target = new Box();
console.log(target.next());
const answer = Object.assign(target, { value: "text" });
console.log(answer === target, typeof answer.value, answer.value.length);
