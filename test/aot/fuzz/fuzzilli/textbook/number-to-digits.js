function digits(number) {
  const out = [];
  do {
    out.push(number % 10);
    number = Math.floor(number / 10);
  } while (number > 0);
  return out.reverse();
}
console.log(digits(Number("9075")).join(), digits(Number("0")).join());
