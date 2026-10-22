function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
console.log(held.join());
