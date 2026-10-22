function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
held.forEach(value => console.log(value + 1));
