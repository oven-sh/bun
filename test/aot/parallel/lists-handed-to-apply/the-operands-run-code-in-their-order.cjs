// The receiver and the elements of the written list are calls: they run in the order of the text, in front of the read of `apply`.. which a getter tells.
const order = [];
const say = word => { order.push(word); return word; };
function target(a, b) { return this + "/" + a + "/" + b; }
Object.defineProperty(target, "apply", { get() { order.push("read"); return Function.prototype.apply; } });
const all = JSON.parse('["target"]');
const table = { target };
function run(turn) { let text = ""; for (let i = 0; i < 2; i++) text += ":" + table[all[0]].apply(say("this" + i), [say("a" + turn), say("b")]); return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 2; turn++) console.log(run(turn), order.join());
