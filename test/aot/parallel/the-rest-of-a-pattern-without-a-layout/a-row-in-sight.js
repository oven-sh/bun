// STATISTIC: ObjectRestsExpandedToDefines >= 1
// The row stands in sight, in and out of a loop: the names that the pattern has taken stay out; a getter among the kept names runs once, one among the names left out runs for the pattern alone.
function show(v) { return Object.keys(v).join() + "|" + JSON.stringify(v) + "|" + ("a" in v); }
var calls = [];
{ const { a, ...rest } = { a: 1, q: 2, w: 3 }; console.log(a, show(rest)); }
{ const { q, ...rest } = { a: 1, q: 2, w: 3 }; console.log(q, show(rest)); }
{ const { a, q, w, ...rest } = { a: 1, q: 2, w: 3 }; console.log(a + q + w, show(rest)); }
{ const { z, ...rest } = { a: 1, q: 2 }; console.log(z, show(rest)); }
{ const { a, ...rest } = { get a() { calls.push("a"); return 1; }, q: 2 }; console.log(a, show(rest)); }
{ const { a, ...rest } = { a: 1, get q() { calls.push("q"); return 2; } }; console.log(a, show(rest)); }
for (var turn = 0; turn < 3; turn++) { const { a, ...rest } = { a: turn, q: turn + 1, w: "x" + turn }; console.log(a, show(rest)); }
console.log(calls.join());
