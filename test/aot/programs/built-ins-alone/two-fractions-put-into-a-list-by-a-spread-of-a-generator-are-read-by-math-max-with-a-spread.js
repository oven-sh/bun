function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
console.log(Math.max(...held) + 1, Math.min(...held) + 1);
