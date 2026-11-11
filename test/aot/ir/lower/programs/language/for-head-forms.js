// RUN: lower
// OPTIONS: builtin-modules

// Within brackets, braces and parentheses `in` is an operator again, also in the head of a `for`. An escaped `async` in front of `of` is a name.
var x;
for ([x = "x" in {}] of [[]]) console.log(x);
for ([x = "length" in []] of [[]]) console.log(x);
for (var a = ["length" in []], i = 0; i < 1; i++) console.log(a[0]);
for (var o = { has: "a" in { a: 1 } }, i = 0; i < 1; i++) console.log(o.has);
for (var t = `${"a" in {}}`, i = 0; i < 1; i++) console.log(t);
for (var k in { one: 1, two: 2 }) console.log(k);
var async;
for (\u0061sync of [7]) console.log(async);
for ((async) of [8]) console.log(async);
