// A null that went through a pair taken apart meets an object where two ways join, behind a loop that never runs.
function f(y, n) {
  let b = null;
  let c = null;
  if (n) c = [1.5];
  while (b !== b) b = [b];
  if (y != b) {
    const pair = [y, b];
    b = pair[0];
    y = pair[1];
    return y === c ? "same" : typeof c;
  }
  return 0;
}
for (const value of [2, 1]) console.log(f(value, 0), f(value, 2));
