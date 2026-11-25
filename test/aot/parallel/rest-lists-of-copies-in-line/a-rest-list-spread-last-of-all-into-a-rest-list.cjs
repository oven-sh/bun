// outer(...r) does nothing with its list but spread it into inner(...s), which hands its own on to who keeps it.
// STATISTIC: RestArrayAllocationsSunk >= 1
const kept = [];
function keep(list) { kept.push(list); return list.join(); }
const flags = JSON.parse("[true,false,true]");
function inner(flag, ...s) { if (!flag) return s.length; return keep(s); }
function outer(flag, ...r) { return inner(flag, ...r); }
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { let text = ""; for (let i = 0; i < upTo[3]; i++) text += "|" + outer(flags[i], turn, i); return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
console.log(kept.length, kept[0] !== kept[1], JSON.stringify(kept));
