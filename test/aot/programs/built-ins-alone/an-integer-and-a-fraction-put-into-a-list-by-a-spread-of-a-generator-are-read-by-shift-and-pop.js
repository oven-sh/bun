function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
console.log(held.shift() + 1, held.pop() + 1);
console.log(held.length, held.pop() === undefined);
