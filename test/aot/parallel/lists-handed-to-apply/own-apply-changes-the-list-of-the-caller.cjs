// A helper hands on a list that its caller holds, and one of the functions has an `apply` of its own that changes the list: the caller sees the change.
const table = { add(a, b) { return this.base + a + b; }, count() { return this.base + arguments.length; }, join(...all) { return this.base + all.join(); } };
const names = JSON.parse('["add","count","join"]');
const holder = { base: 100 };
table.count.apply = function (receiver, list) { list.push("more"); list[0] = "changed"; return "own"; };
function hand(fn, receiver, list) { return fn.apply(receiver, list); }
function run(turn) { let text = ""; for (let i = 0; i < 3; i++) { const list = [turn, i]; const answer = hand(table[names[i]], holder, list); text += ":" + answer + "/" + list.length + "/" + list[0]; } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
