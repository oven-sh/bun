// The function reads its rest list behind the call that takes it, and the taker has changed it: the change is seen.
function change(list) { list[0] = "changed"; list.push("more"); return list.length; }
const flags = JSON.parse("[true,false,true]");
function fire(flag, ...args) { let got = 0; if (flag) got = change(args); return got + ":" + args.length + ":" + args[0]; }
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { let text = ""; for (let i = 0; i < upTo[3]; i++) text += "|" + fire(flags[i], turn, i); return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
