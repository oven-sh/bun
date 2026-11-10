// Who takes the list stores into it and grows it; nobody reads it behind.
// STATISTIC: RestListsMadeWhereTheyLeave >= 1
function change(list) { list[0] = "changed"; list.push("more"); return list.join(); }
const flags = JSON.parse("[true,false,true]");
function fire(flag, ...args) { if (!flag) return args.length + ":" + args[1]; return change(args); }
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { let text = ""; for (let i = 0; i < upTo[3]; i++) text += "|" + fire(flags[i], turn, i); return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
