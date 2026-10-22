function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
const list = held.splice(0);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
