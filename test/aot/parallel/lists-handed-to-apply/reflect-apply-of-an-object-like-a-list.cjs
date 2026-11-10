// The list is an object with a length and elements, one of them a getter.
// STATISTIC: CallsForwardedBehindTestsOfTheirTargets >= 1
const table = { add(a, b) { return this.base + a + b; }, count() { return this.base + arguments.length; }, join(...all) { return this.base + all.join(); } };
const names = JSON.parse('["add","count","join"]');
const holder = { base: 100 };
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
let calls = 0;
const like = { length: 2, 0: "a", get 1() { return ++calls; } };
const wrap = fn => function () { return Reflect.apply(fn, this, like); };
function run(turn) { let text = ""; for (let i = 0; i < upTo[3]; i++) { const wrapped = wrap(table[names[i]]); text += ":" + wrapped.call(holder, turn, i); } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
