// Flags: --aot-check=verify-each-pass
function go(y, z, turns) {
  let b = undefined;
  let lone = undefined; if (z) lone = [1.5];
  for (let k = 0; k < turns; k++) b = Object(b);
  return b === lone ? b : 0;
}
for (const value of ["ab", 1, null, true, {}, 2n, undefined]) console.log(String(go(value, null, 0)), String(go(value, true, 1)), String(go(value, value, 2)));
