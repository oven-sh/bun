const rules = { long: { apply(context, out) { out.push(context.word.length); } }, first: { apply(context, out) { out.push(context.word[0]); out.push(out.length); } } };
const names = JSON.parse('["long","first","long"]');
function runRule(rule, context, out) { rule.apply(context, out); }
function run(turn) { let text = ""; for (let i = 0; i < 3; i++) { const out = []; runRule(rules[names[i]], { word: "w" + turn }, out); text += ":" + out.length + "/" + out.join(); } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
