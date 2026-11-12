// Variables beside a function that has a direct eval, which never runs.
var without = (function () { var heap = new Int32Array(16), never = []; function flush() { while (never.length) (0, eval)(never.pop()); } function run(n) { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { heap[i & 15] = i; s = (s + heap[i & 15]) | 0; } return s; } flush(); return run; })();
var beside = (function () { var heap = new Int32Array(16), never = []; function flush() { while (never.length) eval(never.pop()); } function run(n) { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { heap[i & 15] = i; s = (s + heap[i & 15]) | 0; } return s; } flush(); return run; })();
const loops = {
  "no direct eval": n => { return without(n); },
  "a direct eval in a sibling function": n => { return beside(n); },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name](40));
else console.log(loops[loop](Number(iterations)));
