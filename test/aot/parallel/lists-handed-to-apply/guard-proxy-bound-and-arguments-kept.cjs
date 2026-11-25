function target(a, b) { return this + "/" + arguments.length + "/" + a + "/" + b; }
function keeps() { return arguments; }
const all = { plain: target, bound: target.bind("bound", 7), proxy: new Proxy(target, { apply(to, self, list) { list.push("trap"); return list.join("+"); } }), keeps };
const names = JSON.parse('["plain","bound","proxy","keeps"]');
const wrap = fn => function (...args) { return fn.apply("self", args); };
function run(turn) { let text = ""; for (let i = 0; i < 4; i++) { const answer = wrap(all[names[i]])(turn, i); text += ":" + (typeof answer === "object" ? answer.length + "," + answer[0] : answer); } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
