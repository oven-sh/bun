// A null that went through a pair taken apart meets an object where two ways join, behind a loop that never runs.
function f(y) {
  let b = true;
  while (b !== b) b = [b];
  if (y !== b) {
    [b, y] = [y, b];
    return y;
  }
  return [1.5];
}
for (const value of [2, 1, true]) console.log(JSON.stringify(f(value)));
