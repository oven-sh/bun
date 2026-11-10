// `keep(...[...first, t])`: a list that a spread has filled is spread into the list of a call, which nothing spreads again: it is written out, and the call takes the elements themselves.
const table = { join(a, b, c) { return a + "/" + b + "/" + c + "/" + arguments.length; } };
const name = JSON.parse('"join"');
function run(t) { const first = [t, t + 1]; return table[name](...[...first, 7]) + ":" + new Array(...[...first, 8]).length; }
globalThis.handed = [run];
for (let t = 0; t < 3; t++) console.log(run(t));
