// A null that went through a pair taken apart meets an object where two ways join, behind a loop that never runs.
function f(y, n) {
  let b = null;
  while (b !== b) b = [b];
  if (y != b) {
    [b, y] = [y, b];
    let r = y;
    for (let i = 0; i < n; i++) r = { v: i + 0.5 };
    return r === null ? -1 : r.v;
  }
  return 0;
}
for (const value of [2, 1]) console.log(f(value, 0), f(value, 2));
