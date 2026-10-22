function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
const values = Object.values(target);
console.log(values.length, typeof values[0], values[0] + 1);
