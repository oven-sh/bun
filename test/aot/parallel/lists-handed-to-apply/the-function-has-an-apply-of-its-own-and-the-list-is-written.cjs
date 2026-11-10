// The same where the wrapper writes the list.
const table = { add(a, b) { return this.base + a + b; }, count() { return this.base + arguments.length; }, join(...all) { return this.base + all.join(); } };
const names = JSON.parse('["add","count","join"]');
const holder = { base: 100 };
const seen = [];
table.count.apply = function (receiver, list) { seen.push(list); list.push("more"); return Array.isArray(list) + "/" + list.length + "/" + list.join(); };
const wrap = fn => function (a, b) { return fn.apply(this, [b, a]); };
function run(turn) { let text = ""; for (let i = 0; i < 3; i++) { const wrapped = wrap(table[names[i]]); text += ":" + wrapped.call(holder, turn, i); } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
console.log(seen.length, seen[0] !== seen[1], JSON.stringify(seen));
