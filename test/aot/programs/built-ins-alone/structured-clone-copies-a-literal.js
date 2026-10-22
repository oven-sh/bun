function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
const copy = structuredClone(target);
console.log(copy === target, copy.value + 1, typeof copy.next, Object.keys(copy).join());
