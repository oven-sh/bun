function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
Reflect.defineProperty(target, "value", { value: "text" });
console.log(typeof target.value, target.value.length, next(target));
