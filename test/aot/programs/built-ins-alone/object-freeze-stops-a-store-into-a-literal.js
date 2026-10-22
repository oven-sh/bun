function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
Object.freeze(target);
try {
  target.value = 2;
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(target.value, next(target), Object.isFrozen(target));
