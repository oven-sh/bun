// Two ways end with a call that takes the list; a third reads it.
// STATISTIC: RestListsMadeWhereTheyLeave >= 1
const kept = [];
function first(list) { kept.push(list); return "first" + list.join(); }
function second(list) { kept.push(list); return "second" + list.length; }
const ways = JSON.parse("[0,1,2,1,0]");
function fire(way, ...args) { if (way === 0) return first(args); if (way === 1) return second(args); return "read" + args.length + args[0]; }
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { let text = ""; for (let i = 0; i < upTo[5]; i++) text += "|" + fire(ways[i], turn, i); return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
console.log(new Set(kept).size === kept.length, JSON.stringify(kept[3]));
