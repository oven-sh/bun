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
