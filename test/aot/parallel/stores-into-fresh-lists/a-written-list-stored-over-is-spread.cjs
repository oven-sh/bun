// A written list of variables is stored over by index and spread into a call: what was stored arrives.
// STATISTIC: StoresFollowedIntoFreshLists >= 1
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
const data = JSON.parse('[{"x":3},{"x":"four"},{"x":5.5},{"x":null}]');
const table = { join(a, b, c) { return a + "/" + b + "/" + c + "/" + arguments.length; } };
const name = JSON.parse('"join"');
function make(a, b, c) { const list = [b, b, c]; list[0] = a; list[2] = b; return table[name](...list); }
function run(turn) { let text = ""; for (let i = 0; i < upTo[4]; i++) text += "|" + make(data[i].x, i, turn); return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
