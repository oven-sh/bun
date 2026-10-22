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
Object.defineProperty(target, "value", { writable: false });
try {
  target.value = 2;
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(target.value, target.next());
