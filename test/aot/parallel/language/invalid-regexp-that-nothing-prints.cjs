// The transpiler prints nothing of these literals: nothing runs them, and no declaration beside them stays where it stands. The engine never reads them, and the program runs.
if (/a**/) {} else { var relocated = 1; }
if (/(/) {} else { for (var i = 0; i < 1; i++) {} }
if (/[b-a]/) {} else { try {} catch { var caught; } }
function never(x) {
  "use strict";
  if (/a{2,1}/) {} else { function f() {} }
  if (/)/) {} else { let v = 1; class C {} }
  if (/(?<n>a)(?<n>b)/) {} else { var [] = []; }
  if (!/\1/u) { var w; }
  if (/\p{Nope}/u ? 1 : 0) {} else { var u; }
  if (false) { x(/(?<1>a)/); }
  return x;
  x(/\k<a>/u);
  var t = /a{1/u;
}
console.log(never(2), relocated, i, caught, "ran");
