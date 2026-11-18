// The wrapper hands its rest list on in a loop of its own.
const table = { add(a, b) { return this.base + a + b; }, count() { return this.base + arguments.length; }, join(...all) { return this.base + all.join(); } };
const names = JSON.parse('["add","count","join"]');
const holder = { base: 100 };
const wrap = fn => function (...args) { let text = ""; for (let k = 0; k < 2; k++) text += fn.apply(this, args) + "|"; return text; };
function run(turn) { let text = ""; for (let i = 0; i < 3; i++) { const wrapped = wrap(table[names[i]]); text += ":" + wrapped.call(holder, turn, i); } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
