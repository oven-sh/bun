function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
Object.assign(target, { added: "text" });
console.log(typeof target.added, target.added.length, Object.keys(target).join(), next(target));
