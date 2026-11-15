const out = [];
function shifted(a, b) { Array.prototype.shift.call(arguments); return arguments.length; }
function named(a, b) { const list = arguments; list.length = 9; return arguments.length; }
function handed(change) { change(arguments); return arguments.length; }
function evaluated(text) { eval(text); return arguments.length; }
function spread() { const [first] = [arguments]; first.length = 4; return arguments.length; }
function returned() { return [arguments, () => arguments.length]; }
let all = [shifted, named, spread];
if (Date.now() < 0) all = null;
for (const f of all) out.push(f.name + ": " + [f(), f(1), f(1, 2), f(1, 2, 3)].join(" . "));
out.push("handed: " + [handed(list => { list.length = 0; }), handed(list => { Array.prototype.push.call(list, 1, 2); }), handed(() => { })].join(" . "));
out.push("evaluated: " + [evaluated("arguments.length = 3"), evaluated("1", 2), evaluated("var arguments = 'ab'")].join(" . "));
const [list, count] = returned(1, 2, 3); list.length = 8;
out.push("returned: " + count());
console.log(out.join("\n"));
