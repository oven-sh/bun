function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
const written = JSON.stringify(target);
console.log(typeof written, written.length, written);
