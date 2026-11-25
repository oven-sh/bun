// The list that the loop fills is handed to apply; who is called comes out of data. The function is small and is called with written arguments in a loop: it is copied there, and the turns of its loop are written out.
// STATISTIC: StoresFollowedIntoFreshLists >= 1
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
const data = JSON.parse('[{"x":3},{"x":"four"},{"x":5.5},{"x":null}]');
function show(list) { let text = list.length + "["; for (let i = 0; i < list.length && i < 9; i++) text += (i in list ? String(list[i]) : "-") + ","; return text + "]" + Object.keys(list).length; }
const table = { join(a, b, c) { return a + "/" + b + "/" + c + "/" + arguments.length; } };
const name = JSON.parse('"join"');
function copied() { var args = []; for (var _i = 0; _i < arguments.length; _i++) { args[_i] = arguments[_i]; } return table[name].apply(this, args); }
function run(turn) { const out = []; for (let i = 0; i < upTo[4]; i++) out.push(copied(data[i].x, i, turn)); return out.join("|"); }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
