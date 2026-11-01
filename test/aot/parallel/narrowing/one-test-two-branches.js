function f(a, b, c) {
  if (c === a) {
    c ^= 1;
  }
  for (let i = 0; i < 1 && (c === a || b !== c); i++) {
    if (a === c) {
      console.log(a === c);
    }
  }
  return c;
}
const J = JSON.parse("[7,-8,2]");
console.log(String(f(undefined, undefined, undefined)), String(f(J[0], J[1], J[2])));
