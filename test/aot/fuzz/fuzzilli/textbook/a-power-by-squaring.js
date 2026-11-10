function power(base, exponent) {
  let result = 1;
  while (exponent > 0) {
    if (exponent % 2 === 1) result *= base;
    base *= base;
    exponent = Math.floor(exponent / 2);
  }
  return result;
}
console.log(power(Number("3"), Number("13")), power(2, 0));
