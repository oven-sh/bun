class Box {
  value = 1;
  next() {
    return this.value + 1;
  }
}
const target = new Box();
console.log(target.next());
const written = JSON.stringify(target);
console.log(typeof written, written.length, written);
