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
Object.assign(target, { added: "text" });
console.log(typeof target.added, target.added.length, Object.keys(target).join(), target.next());
