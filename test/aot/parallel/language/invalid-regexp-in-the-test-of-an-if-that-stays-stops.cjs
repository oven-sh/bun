// The transpiler prints these literals though nothing runs them: each stands in the test of an `if` that stays for a declaration in the branch that never runs.
if (/a**/) {} else { async function stays() {} }
function never(x) {
  if (/(/) {} else { var v; }
  if (/[b-a]/) {} else { function* g() {} }
  if (/a{2,1}/) {} else { switch (x) {} }
  if (/)/) {} else { with (x) {} }
  if (/(?<n>a)(?<n>b)/) {} else { function f() {} eval(""); }
  if (/\1/u) {} else { function f() { eval("(function () {})"); } }
  if (/\p{Nope}/u) {} else { for (var i = 0; i < 1; i++) {} }
  if (/(?<1>a)/) {} else { try {} catch { var w; } }
  if (/\k<a>/u) {} else if (x) { var u; }
  if (/a{1/u) {} else var t = 1;
  if ((x(), /\u{110000}/u)) {} else { async function h() {} }
}
globalThis.kept = never;
console.log("ran");
/* Build errors:
error: TS100307: Invalid regular expression: nothing to repeat
error: TS100307: Invalid regular expression: missing )
error: TS100307: Invalid regular expression: range out of order in character class
error: TS100307: Invalid regular expression: numbers out of order in {} quantifier
error: TS100307: Invalid regular expression: unmatched parentheses
error: TS100307: Invalid regular expression: duplicate group specifier name
error: TS100307: Invalid regular expression: invalid backreference for Unicode pattern
error: TS100307: Invalid regular expression: invalid property expression
error: TS100307: Invalid regular expression: invalid group specifier name
error: TS100307: Invalid regular expression: invalid \k<> named backreference
error: TS100307: Invalid regular expression: incomplete {} quantifier for Unicode pattern
error: TS100307: Invalid regular expression: invalid Unicode code point \u{} escape
*/
