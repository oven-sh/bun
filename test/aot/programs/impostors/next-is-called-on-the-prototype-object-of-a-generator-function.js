function* numbers() {
  yield 2;
}

try {
  console.log(numbers.prototype.next());
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(numbers().next().value);
