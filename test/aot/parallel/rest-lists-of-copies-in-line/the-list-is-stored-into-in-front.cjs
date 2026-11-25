// The function stores into its rest list in front of handing it on.
function tell(list) { return list.join(); }
const flags = JSON.parse("[true,false,true]");
function fire(flag, ...args) { args[1] = "stored"; if (!flag) return args.length; return tell(args); }
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { let text = ""; for (let i = 0; i < upTo[3]; i++) text += "|" + fire(flags[i], turn, i); return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
