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
target.__proto__ = { extra: "text" };
console.log(typeof target.extra, target.extra.length, typeof target.next, target.value + 1);
