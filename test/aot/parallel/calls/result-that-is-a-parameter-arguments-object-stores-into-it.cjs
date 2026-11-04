// A sloppy function stores into its parameter through the arguments object and hands the parameter back: the caller gets what was stored and not what it passed.
// Under: --aot-testing=CheckProofsAtRunTime: the result of a call whose callee returns a parameter
function swapped(x) { arguments[0] = "stored"; return x; }
function number() { return typeof swapped(1); }
function object() { return typeof swapped({ a: 1 }); }
function looped() { var s = ""; for (var i = 0; i < 3; i++) s += swapped(i) + ","; return s; }
console.log(number(), object(), looped());
