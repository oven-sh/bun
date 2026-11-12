// One way returns the list itself.
const flags = JSON.parse("[true,false,true]");
function fire(flag, ...args) { if (!flag) return args.length; return args; }
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { let text = ""; for (let i = 0; i < upTo[3]; i++) { const got = fire(flags[i], turn, i); text += "|" + (Array.isArray(got) ? got.join() : got); } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
