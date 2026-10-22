function* numbers() {
  yield 30;
  yield 40;
}
const rest = [...numbers()];
console.log(rest[0], rest[1]);
