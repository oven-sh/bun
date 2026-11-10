const zero = (0, eval)("0");
function run(n) { for (let i = 0; i < n; i++) steps = steps + 1; return steps; }
function attempt(n) { try { return String(run(n)); } catch (error) { return error.name; } }
console.log(attempt(0), attempt(3));
let steps = 10;
console.log(attempt(0), attempt(3));
