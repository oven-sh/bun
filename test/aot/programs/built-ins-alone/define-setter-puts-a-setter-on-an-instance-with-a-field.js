class Box {
  value = 1;
  next() {
    return this.value + 1;
  }
}
const target = new Box();
console.log(target.next());
let stored = "nothing";
target.__defineSetter__("value", value => {
  stored = `stored ${value}`;
});
target.value = 5;
console.log(stored, target.value === undefined, target.next());
