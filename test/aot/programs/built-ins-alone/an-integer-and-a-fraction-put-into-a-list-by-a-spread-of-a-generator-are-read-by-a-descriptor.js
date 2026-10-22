function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
console.log(Object.getOwnPropertyDescriptor(held, 0).value + 1, Object.getOwnPropertyDescriptor(held, 1).value + 1);
