function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
Object.setPrototypeOf(target, null);
console.log(typeof target.next, typeof target.toString, target.value + 1);
