class Box {
  value = 1;
  next() {
    return this.value + 1;
  }
}
const target = new Box();
console.log(target.next());
Object.assign(target, { added: "text" });
console.log(typeof target.added, target.added.length, Object.keys(target).join(), target.next());
