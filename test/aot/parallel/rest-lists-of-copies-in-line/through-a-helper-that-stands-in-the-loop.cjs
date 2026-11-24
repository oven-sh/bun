// The call of fire(flag, ...args) stands in a small helper, and the helper in the loop: a copy within a copy.
// STATISTIC: RestArrayAllocationsSunk >= 1
const kept = [];
function keep(list) { kept.push(list); return list.length; }
const flags = JSON.parse("[true,false,true]");
function fire(flag, ...args) { if (!flag) return args.length + args[0]; return keep(args); }
function step(turn, i) { return fire(flags[i], turn, i) + 1; }
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { let sum = 0; for (let i = 0; i < upTo[3]; i++) sum += step(turn, i); return sum; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
console.log(kept.length, kept[0] !== kept[1], JSON.stringify(kept));
