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
const descriptor = Object.getOwnPropertyDescriptor(target, "value");
console.log(descriptor.value + 1, descriptor.writable, descriptor.enumerable, descriptor.get === undefined);
