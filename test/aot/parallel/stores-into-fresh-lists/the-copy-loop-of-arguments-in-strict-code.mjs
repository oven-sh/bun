// The same in strict code; the last element is read. The function is small and is called with written arguments in a loop: it is copied there, and the turns of its loop are written out.
// STATISTIC: StoresFollowedIntoFreshLists >= 1
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
const data = JSON.parse('[{"x":3},{"x":"four"},{"x":5.5},{"x":null}]');
function copied() { for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) { args[_key] = arguments[_key]; } return args.length + args[2]; }
function run(turn) { const out = []; for (let i = 0; i < upTo[4]; i++) out.push(copied(data[i].x, i, turn)); return out.join("|"); }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
