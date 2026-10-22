class Box {
  value = 1;
  next() {
    return this.value + 1;
  }
}
const target = new Box();
console.log(target.next());
console.log(Reflect.deleteProperty(target, "value"));
console.log(target.value === undefined, "value" in target, Object.keys(target).length, target.next());
