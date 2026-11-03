// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1005 5
// DIAGNOSTIC: TS1042 1
// DIAGNOSTIC: TS1109 1
// DIAGNOSTIC: TS1209 1
// DIAGNOSTIC: TS1488 2

// Each statement is outside the grammar of the language, so the build stops. Plain Bun prints another output.
var a;
var f1 = ((a)) => 1;
var f2 = (a, (b)) => 1;
var f3 = ([(a)]) => 1;
var f4 = ({ a: (b) }) => 1;
var f5 = async ((a)) => 1;
class C { static static {} }
new a?.();
(a, );
console.log(`\8`);
console.log(`\9`);
