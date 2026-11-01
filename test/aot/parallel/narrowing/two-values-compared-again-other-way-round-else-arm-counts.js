// `e === f` is asked, and then `f === e`. The arm where the two differ goes on counting with `f`, not with `e`.
function k(x) {
  let a = x,
    e = -2147483648,
    f = (a + 3) | 0;
  if (e === f) {
    a ^= 1;
  }
  if (f === e) {
    a = 0;
  } else {
    f++;
  }
  return [a, e, f].join();
}
for (const [x] of [[0], [100], [8], [5], [2147483645]]) console.log(k(x));
