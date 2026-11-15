// The wrapper reads its rest list behind the call, and one of the functions has an `apply` of its own that changes the list: the wrapper sees the change.
const table = { add(a, b) { return this.base + a + b; }, count() { return this.base + arguments.length; }, join(...all) { return this.base + all.join(); } };
const names = JSON.parse('["add","count","join"]');
const holder = { base: 100 };
table.count.apply = function (receiver, list) { list.push("more"); list[0] = "changed"; return "own"; };
const wrap = fn => function (...args) { const answer = fn.apply(this, args); return answer + "/" + args.length + "/" + args[0]; };
function run(turn) { let text = ""; for (let i = 0; i < 3; i++) { const wrapped = wrap(table[names[i]]); text += ":" + wrapped.call(holder, turn, i); } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
