// A wrapper hands a list that it writes.
// STATISTIC: CallsForwardedBehindTestsOfTheirTargets >= 1
const table = { add(a, b) { return this.base + a + b; }, count() { return this.base + arguments.length; }, join(...all) { return this.base + all.join(); } };
const names = JSON.parse('["add","count","join"]');
const holder = { base: 100 };
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
const wrap = fn => function (a, b) { return Reflect.apply(fn, this, [b, a, b]); };
function run(turn) { let text = ""; for (let i = 0; i < upTo[3]; i++) { const wrapped = wrap(table[names[i]]); text += ":" + wrapped.call(holder, turn, i); } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
