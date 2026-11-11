const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : typeof v === "function" ? "function " + v.name : v); } catch (e) { return String(e); } };

function kind(x) { return typeof x; }
function half(x) { return x / 2; }
function run(list) { return [list.map(kind), list.map(half)]; }
for (const list of [[1, 2, 3], [0.5, 1.5], [1, 0.5, "x", null, undefined, {}, [4]], ["a", "b"], [1n].map(String), [-0, NaN, Infinity], Object.freeze([2, 4]), new Array(3), Array.from({ length: 2 })]) console.log(say(run(list)));
function asArguments() { return Array.prototype.map.call(arguments, half); } console.log(say(asArguments(2, 4)));
