function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
const heir = Object.create(target, { added: { value: "text", enumerable: true } });
console.log(heir.value + 1, heir.added.length, Object.keys(heir).join(), Object.getPrototypeOf(heir) === target);
