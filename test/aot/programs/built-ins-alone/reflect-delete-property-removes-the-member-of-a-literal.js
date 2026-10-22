function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
console.log(Reflect.deleteProperty(target, "value"));
console.log(target.value === undefined, "value" in target, Object.keys(target).length, next(target));
