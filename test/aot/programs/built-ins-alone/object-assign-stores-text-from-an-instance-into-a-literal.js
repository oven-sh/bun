function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
class Source {
  value = "text";
}
Object.assign(target, new Source());
console.log(typeof target.value, target.value.length, next(target));
