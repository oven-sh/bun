// Numbers that a loop takes as keys, carries and returns: integers, whole numbers beyond int32, -0, Infinity, NaN and fractions.
const show = v => (Object.is(v, -0) ? "-0" : String(v));
function carry(a, i, n, c) {
  for (; i < n; i++) c = (a[i] + c) >> 2;
  return c;
}
function floor(a, i, n, c) {
  for (; i < n; i++) c = Math.floor(c / 2) + (a[i] | 0);
  return c;
}
function grow(a, i, n, c) {
  for (; i < n; i++) c = c * 65536 + 1;
  return c;
}
function negate(a, i, n, c) {
  for (; i < n; i++) c = -c;
  return c;
}
function digit(a, i, n, c) {
  while (i < n) {
    const l = (a[i] & 0x3fff) * 5 + c;
    a[i++] = l & 0x3fff;
    c = l >> 14;
  }
  return c;
}
const lists = [() => [1, 16383, 3, 268435455, 5, 6], () => [0.5, -7, 3, 5e9, -0, 1], () => [1, , 3, 4, , 6]];
const enters = [0, 1, -5, 7, 2147483647, -2147483648, 5e9, -0, Infinity, NaN, 0.5, 2 ** 53];
for (let round = 0; round < 3; round++) {
  for (const list of lists) {
    for (const c of enters) {
      const a = list();
      const r = [carry(a, 0, 6, c), floor(a, 1, 5, c), grow(a, 0, 4, c), negate(a, 0, 3, c), digit(a, 0, 6, c)];
      const w = list();
      w[0] += digit(list(), 0, 6, digit(list(), 2, 5, c));
      if ((w[1] += floor(a, 0, 6, carry(a, 0, 6, c))) >= 100) w[1] -= 100;
      let half = 0;
      for (let k = 0; k < 4; k++) half = half * 0.5 + carry(list(), k, 6, c);
      console.log(show(c), r.map(show).join(), a.map(show).join(), w.map(show).join(), show(half));
    }
  }
}
