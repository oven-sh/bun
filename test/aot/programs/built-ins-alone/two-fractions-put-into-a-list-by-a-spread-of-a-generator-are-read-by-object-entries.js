function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
const entries = Object.entries(held);
console.log(entries[0][1] + 1, entries[1][1] + 1);
