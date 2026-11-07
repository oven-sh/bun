function far(a, b, c, d, e, f, g, h, i, visit) {
  let work = 0;
  for (let k = 0; k < 2; k++) work = (work + k) | 0;
  return work + visit(a + i);
}
function near(a, visit, other) {
  let work = 0;
  for (let k = 0; k < 2; k++) work = (work + k) | 0;
  return work + visit(a) + other(a);
}
function maker(n) {
  let work = 0;
  for (let k = 0; k < 2; k++) work = (work + k) | 0;
  const half = n / 2 + 0.25, whole = n | 0;
  const c0 = n, c1 = n + 1, c2 = n + 2, c3 = n + 3, c4 = n + 4, c5 = n + 5, c6 = n + 6, c7 = n + 7, c8 = n + 8, c9 = n + 9;
  work += far(1, 2, 3, 4, 5, 6, 7, 8, 9, (x) => x + half + whole);
  work += near(n, function (x) { return x + c0 + c1 + c2 + c3 + c4 + c5 + c6 + c7 + c8 + c9; }, (x) => x * 2);
  return work;
}
let sum = 0;
for (let turn = 0; turn < 400; turn++) sum += maker(turn);
console.log(sum);
