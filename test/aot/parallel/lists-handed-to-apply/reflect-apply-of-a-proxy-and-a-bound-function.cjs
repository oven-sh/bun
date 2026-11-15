// The target is a proxy over a function, with a trap and without one, and a bound function.
// STATISTIC: CallsForwardedAfterTargetChecks >= 1
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function base(a, b) { return (this && this.base) + "/" + a + "/" + b; }
const holder = { base: 100 };
const targets = [new Proxy(base, {}), new Proxy(base, { apply(target, receiver, list) { return "trapped" + list.length + Array.isArray(list); } }), base.bind({ base: "bound" }, "first")];
const wrap = fn => function (...args) { return Reflect.apply(fn, this, args); };
function run(turn) { let text = ""; for (let i = 0; i < upTo[3]; i++) text += ":" + wrap(targets[i]).call(holder, turn, i); return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
