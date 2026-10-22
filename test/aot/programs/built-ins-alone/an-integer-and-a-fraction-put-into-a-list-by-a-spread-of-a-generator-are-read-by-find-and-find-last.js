function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
