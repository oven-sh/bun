function* numbers() {
  yield 30;
  yield 40;
}
const [...[...copy]] = numbers();
console.log(copy[0], copy[1]);
