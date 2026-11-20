function run(step, n) { var t = 0; for (var i = 0; i < n; i++) t += step(i); return t; }
function mark(e) { var p = e.prototype; p.m = 1; return Object.defineProperty(e, "prototype", { writable: false }), e; }
function up(i) { return i + 1; } function twice(i) { return i * 2; }
console.log(run(mark(up), 10), run(mark(twice), 10), run(up, 3), run(twice, 3));
