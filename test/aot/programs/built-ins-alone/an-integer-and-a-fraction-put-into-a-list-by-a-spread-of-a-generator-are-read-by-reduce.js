function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
console.log(held.reduceRight((kept, value) => value) + 1, held.reduce((kept, value) => value) + 1);
