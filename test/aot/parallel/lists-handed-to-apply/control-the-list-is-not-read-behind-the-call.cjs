const table = { add(a, b) { return a + b; }, count() { return arguments.length; } };
const names = JSON.parse('["add","count"]');
table.count.apply = function (receiver, list) { list.push("more"); return "own/" + list.join(); };
function hand(fn, receiver, list) { return fn.apply(receiver, list); }
function run(turn) { let text = ""; for (let i = 0; i < 2; i++) text += ":" + hand(table[names[i]], null, [turn, i]); return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
