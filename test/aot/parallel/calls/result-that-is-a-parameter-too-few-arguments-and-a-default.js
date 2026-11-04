// A function hands back its parameter, one caller passes nothing, one passes undefined to a parameter with a default, and one passes more than is taken.
// Under: --aot-testing=CheckProofsAtRunTime: the result of a call whose callee returns a parameter
function id(x) { return x; }
function orFive(x = 5) { return x; }
function second(a, b) { return b; }
function none() { return typeof id(); }
function withDefault() { return orFive(undefined) + orFive() + orFive(1); }
function short() { return String(second("only")); }
function long() { return second("a", "b", "c"); }
function looped() { let s = ""; for (let i = 0; i < 3; i++) s += none() + withDefault() + short() + long() + ","; return s; }
console.log(none(), withDefault(), short(), long(), looped());
