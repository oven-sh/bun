// The `apply` of the program keeps the list that a helper hands on: it is the list that the caller holds.
const table = { add(a, b) { return this.base + a + b; }, count() { return this.base + arguments.length; }, join(...all) { return this.base + all.join(); } };
const names = JSON.parse('["add","count","join"]');
const holder = { base: 100 };
const kept = [];
table.count.apply = function (receiver, list) { kept.push(list); return "own"; };
function hand(fn, receiver, list) { return fn.apply(receiver, list); }
function run(turn) { let text = ""; for (let i = 0; i < 3; i++) { const list = [turn, i]; const answer = hand(table[names[i]], holder, list); text += ":" + answer + "/" + (kept[kept.length - 1] === list); } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
