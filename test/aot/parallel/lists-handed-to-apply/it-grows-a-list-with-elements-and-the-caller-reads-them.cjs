const patches = { add: { apply(state, ops) { ops[0] = "seen"; ops.push(state.at); return ops.length; } }, none: { apply(state, ops) { return ops.length; } } };
const names = JSON.parse('["add","none"]');
const use = (patch, state, ops) => patch.apply(state, ops);
function run(turn) { let text = ""; for (let i = 0; i < 2; i++) { const ops = ["first", turn]; const n = use(patches[names[i]], { at: i }, ops); text += ":" + n + "/" + ops[0] + "/" + ops.length; } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
