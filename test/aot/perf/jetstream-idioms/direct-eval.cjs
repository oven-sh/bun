// Variables beside a function that has a direct eval, which never runs.
var without = (function () { var heap = new Int32Array(16), never = []; function flush() { while (never.length) (0, eval)(never.pop()); } function run(n) { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { heap[i & 15] = i; s = (s + heap[i & 15]) | 0; } return s; } flush(); return run; })();
var beside = (function () { var heap = new Int32Array(16), never = []; function flush() { while (never.length) eval(never.pop()); } function run(n) { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { heap[i & 15] = i; s = (s + heap[i & 15]) | 0; } return s; } flush(); return run; })();
// The strings of these evals follow from the constants of the function.
var written = (function () { function run(n) { var s = 0; for (var i = 0, end = n | 0; i < end; i++) s = (s + Math.imul(i, 3)) | 0; return s; } return run; })();
var settled = (function () { var made = {}, names = ["add", "sub"]; for (var k = 0; k < names.length; k++) made[names[k]] = eval("(function " + names[k] + "(a, b) { return a + b; })"); function run(n) { var s = 0; for (var i = 0, end = n | 0; i < end; i++) s = (s + Math.imul(i, 3)) | 0; return s; } return made.add(1, 2) === 3 ? run : made.sub; })();
const loops = {
  "no direct eval": n => { return without(n); },
  "a direct eval in a sibling function": n => { return beside(n); },
  "a built-in": n => { return written(n); },
  "a built-in beside evals of constant strings": n => { return settled(n); },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name](40));
else console.log(loops[loop](Number(iterations)));
