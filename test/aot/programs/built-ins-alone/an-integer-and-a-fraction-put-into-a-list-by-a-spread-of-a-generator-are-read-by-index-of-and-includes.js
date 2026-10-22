function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
console.log(held.indexOf(1.5), held.includes(7), held.lastIndexOf(7), held.includes(99));
