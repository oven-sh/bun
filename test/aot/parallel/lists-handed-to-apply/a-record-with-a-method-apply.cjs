const makers = { plus: k => ({ apply(target, list) { list.push(target + k); return list.length; } }), call: k => (...all) => all.length + k };
const kinds = JSON.parse('["plus","call","plus"]');
function hand(rule, target, list) { return rule.apply(target, list); }
function run(turn) { let text = ""; for (let i = 0; i < 3; i++) { const list = [turn]; const answer = hand(makers[kinds[i]](i), turn, list); text += ":" + answer + "/" + list.length + "/" + list.join(); } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
