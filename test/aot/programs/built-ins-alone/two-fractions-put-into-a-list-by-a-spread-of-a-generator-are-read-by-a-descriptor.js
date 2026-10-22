function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
console.log(Object.getOwnPropertyDescriptor(held, 0).value + 1, Object.getOwnPropertyDescriptor(held, 1).value + 1);
