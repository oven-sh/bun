// A list that a spread has filled is spread again, into a list and into a call: every element arrives.
const table = { join(a, b, c, d) { return a + "/" + b + "/" + c + "/" + d + "/" + arguments.length; } };
const name = JSON.parse('"join"');
function run(t) { const first = [t, t + 1]; const second = [...first, 7]; const third = [...second, 8]; return third.length + ":" + third[3] + ":" + table[name](...third); }
globalThis.handed = [run];
for (let t = 0; t < 3; t++) console.log(run(t));
