function f(y) {
  let b = null, a = y;
  if (typeof b === typeof b) a = Object(a);
  while (b !== b) b = [b];
  if (a != b) {
    const pair = [a, b]; b = pair[0]; a = pair[1];
    a = +a;
    return typeof b;
  }
}
function go(y) { console.log(f(y)); }
for (const value of ["ab", 1, null, true, {}, 2n]) go(value);
