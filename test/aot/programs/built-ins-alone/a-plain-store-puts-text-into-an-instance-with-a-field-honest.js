class Box {
  value = 1;
  next() {
    return this.value + 1;
  }
}
const target = new Box();
console.log(target.next());
target.value = "text";
console.log(typeof target.value, target.value.length, target.next());
