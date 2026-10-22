function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
console.log(held.indexOf(2.5), held.includes(1.5), held.lastIndexOf(1.5), held.includes(99));
