const table = { add(a, b) { return a + b; }, count() { return arguments.length; }, join(...all) { return all.join(); } };
const names = JSON.parse('["add","count","join"]');
let kept;
table.count.apply = function (receiver, list) { kept = list; list.push("more"); return "own" + list.length; };
function handOn(fn, list) { const answer = fn.apply(undefined, list); return answer + "/" + list.length; }
function run(turn) { let text = ""; for (let i = 0; i < 3; i++) { const list = [turn, i]; text += ":" + handOn(table[names[i]], list) + "/" + list.length + "/" + (kept === list); } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
