class Box {
  value = 1;
  next() {
    return this.value + 1;
  }
}
const target = new Box();
console.log(target.next());
Object.setPrototypeOf(target, null);
console.log(typeof target.next, typeof target.toString, target.value + 1);
