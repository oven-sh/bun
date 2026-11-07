function run(step, count) { var total = 0; for (var i = 0; i < count; i++) total += step(i); return total; }
function up(n) { return n + 1; }
function twice(n) { return n * 2; }
function text(n) { return n & 1 ? "x" : 0; }
var said = [];
for (var round = 0; round < 3; round++) said.push(run(up, 50), run(twice, 50), run(text, 5));
said.push(run(function (n) { return n - 1; }.bind(null), 10), run(new Proxy(up, {}), 10), run(Math.abs, 10));
try { run(null, 1); } catch (e) { said.push(e.name); }
try { run({}, 1); } catch (e) { said.push(e.name); }
said.push(run(null, 0));
console.log(said.join("|"));
