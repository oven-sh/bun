// outer(...r) spreads its list into inner(...s), which hands its own on to who changes it; outer reads its list behind: it is another list and has not changed.
// STATISTIC: RestArrayAllocationsSunk >= 1
function change(list) { list.push("more"); list[0] = "changed"; return list.length; }
const flags = JSON.parse("[true,false,true]");
function inner(flag, ...s) { if (!flag) return s.length; return change(s); }
function outer(flag, ...r) { const got = inner(flag, ...r); return got + ":" + r.length + ":" + r[0]; }
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { let text = ""; for (let i = 0; i < upTo[3]; i++) text += "|" + outer(flags[i], turn, i); return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
