function next(box) {
  return box.value + 1;
}
const target = { value: 1 };
console.log(next(target));
const descriptor = Object.getOwnPropertyDescriptor(target, "value");
console.log(descriptor.value + 1, descriptor.writable, descriptor.enumerable, descriptor.get === undefined);
