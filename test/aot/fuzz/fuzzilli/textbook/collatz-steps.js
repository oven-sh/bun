function steps(number) {
  let count = 0;
  while (number !== 1) {
    number = number % 2 === 0 ? number / 2 : 3 * number + 1;
    count++;
  }
  return count;
}
console.log(steps(Number("27")), steps(Number("1")));
