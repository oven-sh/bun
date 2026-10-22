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
target.push = Array.prototype.push;
target.push("text");
console.log(target.length, typeof target[0], target[0].length, target.next());
