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
const descriptor = { value: "text" };
Object.defineProperty(target, "value", descriptor);
console.log(typeof target.value, target.value.length, target.next());
