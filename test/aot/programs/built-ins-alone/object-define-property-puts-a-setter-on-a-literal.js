function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
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
console.log(typeof target.value, target.value.length, next(target));
