// The outer loop pushes before and after the inner one
function wrapEach(a, b, c) {
  const values = [a, b, c];
  const out = [];
  for (let i = 0; i < 3; i++) {
    out.push("(");
    for (let k = 0; k <= i; k++) out.push(values[k]);
    out.push(")");
  }
  return out.join(" ");
}
console.log(wrapEach(1, 2, 3));
console.log(wrapEach("x", null, 2.5));
console.log(wrapEach(-0, NaN, undefined), wrapEach([], {}, true));
