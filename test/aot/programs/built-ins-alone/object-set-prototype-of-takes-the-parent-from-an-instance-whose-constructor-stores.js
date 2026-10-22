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
Object.setPrototypeOf(target, null);
console.log(typeof target.next, typeof target.toString, target.value + 1);
