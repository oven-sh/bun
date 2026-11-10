// The target is undefined, null, a number, a text, a plain object, an object below Function.prototype, a class: the error is the one of plain Bun.
// STATISTIC: CallsForwardedBehindTestsOfTheirTargets >= 1
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
class Made {}
const others = [undefined, null, 5, "text", {}, Object.create(Function.prototype), Made];
const wrap = fn => function (...args) { return Reflect.apply(fn, this, args); };
function run(turn) { let text = ""; for (let i = 0; i < upTo[7]; i++) { try { text += ":" + wrap(others[i])(turn, i); } catch (error) { text += ":" + error.name + " " + error.message; } } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 2; turn++) console.log(run(turn));
