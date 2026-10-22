class Box {
  value = 1;
  next() {
    return this.value + 1;
  }
}
const target = new Box();
console.log(target.next());
const values = Object.values(target);
console.log(values.length, typeof values[0], values[0] + 1);
