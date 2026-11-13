// The transpiler prints these literals though nothing runs them, so the engine reads them. They stand in the test of an `if` that stays for a declaration in its branch, in what a statement or a function that stays there holds, and beside a declaration behind a `return`.
if (/a**/) {} else { function stays() {} }
function never(x) {
  if (/(/) {} else { var v; }
  if (false) { function f(a = /[b-a]/) {} }
  if (false) { function f() { function g(a = /a{2,1}/) {} } }
  if (false) { if (x.y == /)/) { var w; } }
  if (false) { for (const k of [/(?<n>a)(?<n>b)/]) { function f() {} } }
  if (false) { for (let i = x(/\1/u); ; ) { function f() {} } }
  if (false) { do { var u; } while (/\p{Nope}/u); }
  if (false) { try {} catch ({ a = /(?<1>a)/ }) { function f() {} } }
  if (false) { switch (/\k<a>/u) { case /a{1/u: } }
  return 1;
  { function f() { return /\u{110000}/u; } }
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
