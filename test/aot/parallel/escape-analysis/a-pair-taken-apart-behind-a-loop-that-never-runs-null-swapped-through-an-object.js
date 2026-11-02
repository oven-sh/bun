function f(y) {
  let b = null, a = y;
  if (typeof b === typeof b) a = Object(a);
  while (b !== b) b = [b];
  if (a != b) {
    const pair = { first: a, second: b }; b = pair.first; a = pair.second;
    a = +a;
    return typeof b;
  }
}
function go(y) { console.log(f(y)); }
for (const value of ["ab", 1, null, true, {}, 2n]) go(value);
