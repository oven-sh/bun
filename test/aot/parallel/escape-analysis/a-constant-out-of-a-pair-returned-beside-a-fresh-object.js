// A null that went through a pair taken apart meets an object where two ways join, behind a loop that never runs.
function f(y) {
  let b = null;
  while (b !== b) b = [b];
  if (y != b) {
    [b, y] = [y, b];
    return y;
  }
  return { v: 1.5 };
}
for (const value of [2, 1, null, undefined]) console.log(JSON.stringify(f(value)));
