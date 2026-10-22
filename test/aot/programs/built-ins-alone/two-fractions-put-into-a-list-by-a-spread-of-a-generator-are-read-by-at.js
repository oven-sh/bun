function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
console.log(held.at(0) + 1, held.at(-1) + 1);
