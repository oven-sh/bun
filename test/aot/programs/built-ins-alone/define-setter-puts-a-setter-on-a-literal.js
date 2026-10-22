function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
let stored = "nothing";
target.__defineSetter__("value", value => {
  stored = `stored ${value}`;
});
target.value = 5;
console.log(stored, target.value === undefined, next(target));
