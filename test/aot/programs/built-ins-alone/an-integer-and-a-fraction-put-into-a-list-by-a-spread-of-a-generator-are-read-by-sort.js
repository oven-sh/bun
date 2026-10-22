function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
held.sort((left, right) => left - right);
console.log(held[0] + 1, held[1] + 1);
