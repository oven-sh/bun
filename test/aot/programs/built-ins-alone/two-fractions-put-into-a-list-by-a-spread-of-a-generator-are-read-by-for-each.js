function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
held.forEach(value => console.log(value + 1));
