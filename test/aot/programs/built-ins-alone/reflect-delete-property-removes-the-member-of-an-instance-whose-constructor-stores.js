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
console.log(Reflect.deleteProperty(target, "value"));
console.log(target.value === undefined, "value" in target, Object.keys(target).length, target.next());
