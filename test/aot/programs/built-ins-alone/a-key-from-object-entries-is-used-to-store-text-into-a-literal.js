function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
for (const [key, value] of Object.entries(target)) target[key] = `text ${value}`;
console.log(typeof target.value, target.value.length, next(target));
