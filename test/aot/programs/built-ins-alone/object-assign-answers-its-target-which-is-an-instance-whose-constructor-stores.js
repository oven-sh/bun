class Box {
  constructor(value) {
    this.value = value;
  }
  next() {
    return this.value + 1;
  }
}
const target = new Box(1);
console.log(target.next());
const answer = Object.assign(target, { value: "text" });
console.log(answer === target, typeof answer.value, answer.value.length);
