class Box {
  value = 1;
  next() {
    return this.value + 1;
  }
}
const target = new Box();
console.log(target.next());
const answer = Object.assign(target, { value: "text" });
console.log(answer === target, typeof answer.value, answer.value.length);
