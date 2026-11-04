// A null that went through a pair taken apart meets an object where two ways join, behind a loop that never runs.
function f(y, n) {
  let b = null;
  let c = null;
  if (n) c = { k: 1.5 };
  while (b !== b) b = [b];
  if (y != b) {
    [b, y] = [y, b];
    return c === y ? c : 1;
  }
  return 0;
}
for (const value of [2, 1]) console.log(JSON.stringify(f(value, 0)), JSON.stringify(f(value, 2)));
