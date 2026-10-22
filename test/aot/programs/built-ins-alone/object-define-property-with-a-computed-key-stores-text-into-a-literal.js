function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
const key = ["val", "ue"].join("");
Object.defineProperty(target, key, { value: "text" });
console.log(typeof target.value, target.value.length, next(target));
