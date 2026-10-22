function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
const descriptor = { value: "text" };
Object.defineProperty(target, "value", descriptor);
console.log(typeof target.value, target.value.length, next(target));
