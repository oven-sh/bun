function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
const source = {
  get value() {
    return "text";
  },
};
Object.assign(target, source);
console.log(typeof target.value, target.value.length, next(target));
