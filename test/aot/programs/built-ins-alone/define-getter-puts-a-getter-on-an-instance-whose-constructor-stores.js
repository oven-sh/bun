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
target.__defineGetter__("value", () => "text");
console.log(typeof target.value, target.value.length, target.next());
