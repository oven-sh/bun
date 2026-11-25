// A loop whose bound comes out of data reads a known place at the head of each turn and stores to it; behind the loop it is read again.
// STATISTIC: StoresFollowedIntoFreshLists >= 1
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
const data = JSON.parse('[{"x":3},{"x":"four"},{"x":5.5},{"x":null}]');
function show(list) { let text = list.length + "["; for (let i = 0; i < list.length && i < 9; i++) text += (i in list ? String(list[i]) : "-") + ","; return text + "]" + Object.keys(list).length; }
function make(a, b) { const list = new Array(2); list[0] = a; let text = ""; for (let i = 0; i < upTo[b]; i++) { text += list[0] + ","; list[0] = i; list[1] = text.length; } return text + ":" + list[0] + ":" + list[1]; }
function run(turn) { let text = ""; for (let i = 0; i < upTo[4]; i++) text += "|" + make(data[i].x, i, turn); return text; }
globalThis.handed = [run, show];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
