function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
Object.preventExtensions(target);
try {
  target.added = 2;
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(target.added === undefined, Object.keys(target).join(), next(target));
