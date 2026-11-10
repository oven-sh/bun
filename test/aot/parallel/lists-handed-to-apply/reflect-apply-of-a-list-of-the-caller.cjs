// A helper hands on a list that its caller holds and reads behind the call; what is called changes nothing of it, for it is handed the elements.
// STATISTIC: CallsForwardedBehindTestsOfTheirTargets >= 1
const table = { add(a, b) { return this.base + a + b; }, count() { return this.base + arguments.length; }, join(...all) { return this.base + all.join(); } };
const names = JSON.parse('["add","count","join"]');
const holder = { base: 100 };
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function hand(fn, receiver, list) { return Reflect.apply(fn, receiver, list); }
function run(turn) { let text = ""; for (let i = 0; i < upTo[3]; i++) { const list = [turn, i]; text += ":" + hand(table[names[i]], holder, list) + "/" + list.length + list[0]; } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
