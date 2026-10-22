function* numbers() {
  yield 30;
  yield 40;
}
const [...rest] = numbers();
const [...copy] = rest;
console.log(copy[0], copy[1]);
