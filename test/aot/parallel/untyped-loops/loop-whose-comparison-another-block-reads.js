// The compiler crashed: a long loop gets a copy that polls between stretches of turns, and the copy looked for the counter in the comparison under its
// branch. Here the back end shares `k < a.length` with another block, so the branch reads the comparison from a variable.
function f(a, n) {
  for (let i = 0; i < a.length; i++) a[i] = 1;
  let s = "Ā";
  if (n) s += "y";
  else { let g = 0; for (let k = 0; k < a.length; k++) if (++g > 32) break; }
  console.log(JSON.stringify(s));
}
const arr = [];
for (let t = 0; t < 2; t++) f(arr, t);
