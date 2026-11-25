// One call is handed the list twice: the two are one object.
function same(a, b) { a.push(1); return (a === b) + ":" + b.length; }
const flags = JSON.parse("[true,false,true]");
function fire(flag, ...args) { if (!flag) return args.length; return same(args, args); }
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { let text = ""; for (let i = 0; i < upTo[3]; i++) text += "|" + fire(flags[i], turn, i); return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
