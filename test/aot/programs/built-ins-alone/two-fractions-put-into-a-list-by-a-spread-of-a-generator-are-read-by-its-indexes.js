function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
console.log(held.length);
console.log(held[0] + 1, held[1] + 1);
console.log(held[2] === undefined);
