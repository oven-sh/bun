// One of the functions has a member `apply` of its own: it is called, with a true list that holds the operands, and may keep and change it.
const table = { add(a, b) { return this.base + a + b; }, count() { return this.base + arguments.length; }, join(...all) { return this.base + all.join(); } };
const names = JSON.parse('["add","count","join"]');
const holder = { base: 100 };
const seen = [];
table.count.apply = function (receiver, list) { seen.push(list); list.push("more"); return Array.isArray(list) + "/" + list.length + "/" + list.join() + "/" + (receiver === holder); };
const wrap = fn => function (...args) { return fn.apply(this, args); };
function run(turn) { let text = ""; for (let i = 0; i < 3; i++) { const wrapped = wrap(table[names[i]]); text += ":" + wrapped.call(holder, turn, i); } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
console.log(seen.length, seen[0] !== seen[1], JSON.stringify(seen));
