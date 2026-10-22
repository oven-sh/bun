function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
const list = held.flatMap(value => [value]);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
