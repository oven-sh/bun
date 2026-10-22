function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
const list = held.toReversed().toReversed();
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
