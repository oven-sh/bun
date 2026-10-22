function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
