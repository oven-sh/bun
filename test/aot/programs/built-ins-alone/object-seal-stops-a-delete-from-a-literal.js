function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
Object.seal(target);
try {
  delete target.value;
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(target.value, next(target));
