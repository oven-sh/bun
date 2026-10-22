function* numbers() {
  yield 30;
  yield 40;
  yield 50;
}
const rest = [...numbers()];
console.log(rest[0] + 1, rest[2]);
