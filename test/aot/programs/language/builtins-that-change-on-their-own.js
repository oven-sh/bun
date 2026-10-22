// Some built-in properties change without a store by the program: the static properties of RegExp after a match, `process.exitCode`, the clock. Each read gives the value of that moment, as in plain Bun.
function lastMatch() { return RegExp.lastMatch + " " + RegExp.$1 + " " + RegExp.leftContext; }
/(b)/.exec("abc");
console.log(lastMatch());
/(c)/.exec("abc");
console.log(lastMatch());
"xyz".replace(/(y)/, "");
console.log(lastMatch());
console.log(process.exitCode);
process.exitCode = 3;
console.log(process.exitCode);
process.exitCode = 0;
console.log(process.exitCode);
const before = performance.now();
let spins = 0;
while (performance.now() === before) spins++;
console.log(performance.now() > before, spins >= 0);
