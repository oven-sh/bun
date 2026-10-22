function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
const [first, second, third] = held;
console.log(first + 1, second + 1);
console.log(third === undefined);
