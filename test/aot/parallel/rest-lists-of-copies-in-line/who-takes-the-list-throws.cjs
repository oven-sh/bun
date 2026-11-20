// Who takes the list throws it; the caller of the loop catches and reads it.
function refuse(list) { throw list; }
const flags = JSON.parse("[false,true,false]");
function fire(flag, ...args) { if (!flag) return args.length; return refuse(args); }
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { let text = ""; for (let i = 0; i < upTo[3]; i++) { try { text += "|" + fire(flags[i], turn, i); } catch (thrown) { text += "|caught" + thrown.join(); } } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
