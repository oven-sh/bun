// Copies of one turn leave the same product to a remainder: the rare branch makes it once.
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
};
function square(x, modulus) {
  return (x * x) % modulus;
}
function squares(...moduli) {
  let sum = 0n;
  for (const modulus of [...moduli]) {
    let x = 3n;
    for (let i = 0; i < 100; i++) x = square(x, modulus);
    sum += x;
  }
  return sum;
}
function squaresOfLiteral(bits) {
  let sum = 0n;
  for (const modulus of [1n << bits]) {
    let x = 3n;
    for (let i = 0; i < 100; i++) x = square(x, modulus);
    sum += x;
  }
  return sum;
}
function squaresOfPushed(bits) {
  const moduli = [];
  moduli.push((1n << bits) - 1n);
  let sum = 0n;
  for (const modulus of moduli) {
    let x = 3n;
    for (let i = 0; i < 12; i++) x = square(x, modulus);
    sum += x;
  }
  return sum;
}
console.log(squares(7n, 11n, (1n << 61n) - 1n), squaresOfLiteral(61n), squaresOfLiteral(31n));
console.log(squaresOfPushed(61n), squaresOfPushed(31n), squaresOfPushed(127n), squaresOfPushed(1n));
console.log(attempt(() => squares(5n, 0n)), attempt(() => squares(5n, 7)), squares(-13n, 1n << 200n));
console.log(attempt(() => squaresOfPushed(0n)), attempt(() => squaresOfLiteral(0n)), attempt(() => squaresOfLiteral(5)));
