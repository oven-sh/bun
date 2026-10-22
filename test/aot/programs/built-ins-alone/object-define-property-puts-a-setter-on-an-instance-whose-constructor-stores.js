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
let stored = "nothing";
Object.defineProperty(target, "value", {
  get() {
    return stored;
  },
  set(value) {
    stored = `stored ${value}`;
  },
});
target.value = 5;
console.log(typeof target.value, target.value.length, target.next());
