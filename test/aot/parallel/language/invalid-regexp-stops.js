// The transpiler prints these literals, so the engine reads them. The function is never called.
function never(x) {
  const used = /a**/;
  for (/(/; ; ) break;
  x(/[b-a]/ || used);
  x([/a{2,1}/]);
  do break; while (/)/);
  for (;; /(?<n>a)(?<n>b)/) break;
  x(typeof [/\1/u]);
  x((1, /\p{Nope}/u));
  switch (/(?<1>a)/) { default: }
  [.../\k<a>/u];
  ({ [/a{1/u]: 1 });
  x(/\u{110000}/u ?? 1);
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
