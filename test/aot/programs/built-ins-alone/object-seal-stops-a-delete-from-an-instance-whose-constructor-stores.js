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
Object.seal(target);
try {
  delete target.value;
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(target.value, target.next());
