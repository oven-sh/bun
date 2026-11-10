// Who stores into the list comes out of data: the caller reads what that one has laid over its own store.
// STATISTIC: StoresFollowedIntoFreshLists >= 1
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
const data = JSON.parse('[{"x":3},{"x":"four"},{"x":5.5},{"x":null}]');
function show(list) { let text = list.length + "["; for (let i = 0; i < list.length && i < 9; i++) text += (i in list ? String(list[i]) : "-") + ","; return text + "]" + Object.keys(list).length; }
const table = { fill(list, a) { list[0] = a; list[2] = a; } };
const name = JSON.parse('"fill"');
function make(a, b) { const list = new Array(2); list[0] = b; table[name](list, a); return list[0] + ":" + list[1] + ":" + list[2] + ":" + list.length; }
function run(turn) { let text = ""; for (let i = 0; i < upTo[4]; i++) text += "|" + make(data[i].x, i, turn); return text; }
globalThis.handed = [run, show];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
