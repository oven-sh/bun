function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
target.push = Array.prototype.push;
target.push("text");
console.log(target.length, typeof target[0], target[0].length, next(target));
