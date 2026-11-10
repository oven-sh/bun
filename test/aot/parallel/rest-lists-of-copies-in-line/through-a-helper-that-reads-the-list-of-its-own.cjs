// The helper has a rest list of its own, which it spreads into fire() and reads behind the call; who takes the inner list changes it: the outer one has not changed.
function change(list) { list.push("more"); list[0] = "changed"; return list.length; }
const flags = JSON.parse("[true,false,true]");
function fire(flag, ...args) { if (!flag) return args.length; return change(args); }
function step(flag, ...mine) { const got = fire(flag, ...mine); return got + ":" + mine.length + ":" + mine[0]; }
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { let text = ""; for (let i = 0; i < upTo[3]; i++) text += "|" + step(flags[i], turn, i); return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
