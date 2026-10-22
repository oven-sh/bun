function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
target.__proto__ = { extra: "text" };
console.log(typeof target.extra, target.extra.length, typeof target.next, target.value + 1);
