// The transpiler prints nothing of these literals: nothing runs them, and no declaration beside them must stay. The engine never reads them, and the program runs.
if (/a**/) {} else { var relocated = 1; }
function strict(x) {
  "use strict";
  if (/(/) {} else { function f() {} }
  if (false) { function f(a = /[b-a]/) {} }
  return x;
  { function f() { return /a{2,1}/; } }
}
function sloppy(x) {
  let f;
  if (/)/) {} else { function f() {} }
  if (/(?<n>a)(?<n>b)/) {} else { function arguments() {} }
  if (/\1/u) {} else { let v = 1; class C {} }
  if (false) { function g() { return /\p{Nope}/u; } }
  if (false) { function g(a = () => /(?<1>a)/) {} }
  if (false) { x(/\k<a>/u); }
  return x;
  x(/a{1/u);
  var w = /\u{110000}/u;
}
console.log(strict(1), sloppy(2), relocated, "ran");
