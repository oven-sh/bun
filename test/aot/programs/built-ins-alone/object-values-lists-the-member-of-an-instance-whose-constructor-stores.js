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
const values = Object.values(target);
console.log(values.length, typeof values[0], values[0] + 1);
