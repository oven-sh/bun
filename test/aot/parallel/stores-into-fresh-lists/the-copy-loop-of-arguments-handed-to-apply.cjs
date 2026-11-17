// The list that the loop fills is handed to apply; who is called comes out of data. The function is small and is called with written arguments in a loop: it is copied there, and the turns of its loop are written out.
// STATISTIC: StoresFollowedIntoFreshLists >= 1
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
const data = JSON.parse('[{"x":3},{"x":"four"},{"x":5.5},{"x":null}]');
const table = { join(a, b, c) { return a + "/" + b + "/" + c + "/" + arguments.length; } };
const name = JSON.parse('"join"');
function copied() { for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) { args[_key] = arguments[_key]; } return table[name].apply(this, args); }
function run(turn) { const out = []; for (let i = 0; i < upTo[4]; i++) out.push(copied(data[i].x, i, turn)); return out.join("|"); }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
