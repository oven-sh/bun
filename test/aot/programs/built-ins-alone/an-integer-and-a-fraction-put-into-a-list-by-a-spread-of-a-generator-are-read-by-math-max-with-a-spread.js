function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
console.log(Math.max(...held) + 1, Math.min(...held) + 1);
