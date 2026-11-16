const table = { add(a, b) { return a + b; }, count() { return arguments.length; } };
const names = JSON.parse('["add","count"]');
table.count.apply = function (receiver, list) { list.length = 0; return "own"; };
function inner(fn, receiver, list) { return fn.apply(receiver, list); }
function outer(fn, list) { return inner(fn, null, list); }
function run(turn) { let text = ""; for (let i = 0; i < 2; i++) { const list = [turn, i, "tail"]; const answer = outer(table[names[i]], list); text += ":" + answer + "/" + list.length; } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
