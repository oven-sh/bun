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
Object.preventExtensions(target);
try {
  target.added = 2;
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(target.added === undefined, Object.keys(target).join(), target.next());
